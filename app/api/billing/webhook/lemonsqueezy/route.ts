import { NextResponse } from "next/server"
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { adminConfigProblem, getAdminApp, isAdminConfigured } from "@/lib/firebase/admin"
import {
    fetchSubscriptionAttributes,
    grantPlan,
    planForVariant,
    revokePlan,
    verifyWebhookSignature,
    recordPaymentFailure,
} from "@/lib/billing/lemonsqueezy"
import { notifyUser } from "@/lib/email"
import { getSiteUrl } from "@/lib/site-url"

// crypto and firebase-admin both need Node, not Edge.
export const runtime = "nodejs"
// A webhook whose answer depends on a signature header must never be cached.
export const dynamic = "force-dynamic"

/** Events that mean "this account should have a plan, until this date". */
const GRANTING = new Set([
    "subscription_created",
    "subscription_updated",
    "subscription_resumed",
    "subscription_unpaused",
    "subscription_plan_changed",
    "subscription_payment_success",
    // A cancelled subscription is still a paid one until the period runs out.
    // Revoking on the click would take away what the customer already paid for.
    "subscription_cancelled",
    // A renewal that failed and then went through. Lemon Squeezy sends this
    // instead of another payment_success, so without it a subscriber who
    // recovered from a failed card kept their old period end and lapsed on it.
    "subscription_payment_recovered",
    // Whether a pause takes access away depends on how it was set up, so this
    // is decided from the payload further down rather than by which set it is
    // in. See pauseMode().
    "subscription_paused",
])

/** Events that mean "this account should not have a plan, as of now". */
const REVOKING = new Set(["subscription_expired", "subscription_payment_refunded"])

/**
 * Events whose `data` is a subscription-invoice rather than a subscription.
 *
 * These carry a payment, not a plan: the attributes hold `subscription_id` and
 * a payment status, and none of `variant_id`, `renews_at` or `ends_at`. Read as
 * though they were subscriptions they match no variant, so every renewal fell
 * into the "nothing granted" branch below and a paying subscriber's plan
 * quietly lapsed at the end of their first period. `data.id` is the invoice's
 * own id too, which is why the account lookup takes the subscription id from
 * the attributes rather than from `data`.
 */
const INVOICE_EVENTS = new Set([
    "subscription_payment_success",
    "subscription_payment_refunded",
    "subscription_payment_recovered",
    "subscription_payment_failed",
])

/**
 * Events that record something and leave the plan alone.
 *
 * A failed renewal is not a lapsed subscription. Lemon Squeezy retries over
 * several days and only sends subscription_expired if every attempt fails, so
 * revoking on the first failure would lock out a customer over a card they are
 * about to replace.
 */
const INFORMATIONAL = new Set(["subscription_payment_failed"])

/** Subscription states that are over, whatever event carried them. */
const DEAD_STATUSES = new Set(["expired", "unpaid"])

interface Payload {
    meta?: {
        event_name?: string
        test_mode?: boolean
        custom_data?: Record<string, unknown>
    }
    data?: {
        id?: string
        attributes?: Record<string, unknown>
    }
}

function millis(value: unknown): number | null {
    if (typeof value !== "string" || !value) return null
    const at = Date.parse(value)
    return Number.isFinite(at) ? at : null
}

/** Lemon Squeezy sends ids as numbers in webhooks and as strings in API responses. */
function asId(value: unknown): string | null {
    if (typeof value === "string") return value.trim() || null
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return null
}

/**
 * Which account this event belongs to.
 *
 * The uid travels in the checkout's custom data, which is the only identifier
 * that survives the customer paying with a different email than they signed up
 * with. The two fallbacks are for subscriptions created before that was in
 * place, or by hand in the Lemon Squeezy dashboard.
 *
 * The subscription id is passed in rather than read from `data.id`, because
 * that field is only the subscription on subscription events: on an invoice
 * event it is the invoice and on an order event it is the order, so looking
 * either of them up in `subscriptions` could only ever miss.
 */
async function resolveUid(payload: Payload, subscriptionId: string | null): Promise<string | null> {
    const uid = await findUid(payload, subscriptionId)
    if (!uid) return null

    // A deleted account keeps receiving events for a while — the cancellation
    // it triggered, the end of the paid period. Applying them would bring the
    // user document back as an orphan holding a plan.
    const deleted = await getFirestore(getAdminApp()).collection("deletedAccounts").doc(uid).get()
    if (deleted.exists) {
        console.log(`[lemonsqueezy] ignoring an event for deleted account ${uid}`)
        return null
    }

    return uid
}

async function findUid(payload: Payload, subscriptionId: string | null): Promise<string | null> {
    const fromCustom = payload.meta?.custom_data?.user_id
    if (typeof fromCustom === "string" && fromCustom) return fromCustom

    const store = getFirestore(getAdminApp())

    if (subscriptionId) {
        const byId = await store
            .collection("subscriptions")
            .where("subscriptionId", "==", subscriptionId)
            .limit(1)
            .get()
        if (!byId.empty) return byId.docs[0].id
    }

    const email = payload.data?.attributes?.user_email
    if (typeof email === "string" && email) {
        const byEmail = await store.collection("users").where("email", "==", email).limit(1).get()
        if (!byEmail.empty) return byEmail.docs[0].id
    }

    return null
}

/**
 * Whether this exact event has already been applied.
 *
 * `create()` is the whole mechanism: it fails if the document exists, which
 * makes the check and the claim one atomic operation rather than a read
 * followed by a write that two concurrent deliveries can both pass.
 */
async function claimEvent(key: string): Promise<boolean> {
    try {
        await getFirestore(getAdminApp())
            .collection("billing_events")
            .doc(key)
            .create({ at: FieldValue.serverTimestamp() })
        return true
    } catch {
        return false
    }
}

/**
 * Hands a claim back after a failed attempt.
 *
 * The claim is taken before the work, so without this a delivery that failed
 * halfway stayed claimed: Lemon Squeezy's retry matched the claim written
 * moments earlier, was waved through as a duplicate, and the event was never
 * applied. That turned a momentary Firestore error into a paying customer
 * permanently not getting their plan.
 */
async function releaseEvent(key: string): Promise<void> {
    try {
        await getFirestore(getAdminApp()).collection("billing_events").doc(key).delete()
    } catch (err) {
        console.error(`[lemonsqueezy] could not release the claim on ${key}`, err)
    }
}

export async function POST(req: Request) {
    // Read once, as text. Parsing and re-serialising changes key order and
    // whitespace, and the signature is over the exact bytes that were sent.
    const raw = await req.text()

    if (!verifyWebhookSignature(raw, req.headers.get("x-signature"))) {
        // No detail in the response and none in the log beyond this line: a
        // caller who cannot sign should not be told whether the secret is
        // missing, the header is absent, or the digest simply did not match.
        console.warn("[lemonsqueezy] rejected a webhook with a bad signature")
        return NextResponse.json({ error: "Invalid signature." }, { status: 401 })
    }

    // Checked after the signature so an unconfigured deployment cannot be
    // probed for which of its credentials are missing.
    if (!isAdminConfigured()) {
        // The Firebase problem, not the Lemon Squeezy one: this branch is about
        // the credentials that do the writing. Reporting the other module's
        // state here printed a bare "null" on the single line meant to say why
        // a verified payment could not be applied.
        console.error(`[lemonsqueezy] cannot apply a verified webhook: ${adminConfigProblem()}`)
        return NextResponse.json({ error: "Not configured." }, { status: 503 })
    }

    let payload: Payload
    try {
        payload = JSON.parse(raw) as Payload
    } catch {
        return NextResponse.json({ error: "Malformed body." }, { status: 400 })
    }

    const event = payload.meta?.event_name ?? ""
    const attrs = payload.data?.attributes ?? {}
    const objectId = payload.data?.id ?? "unknown"

    // updated_at is in the key so a genuine later change to the same
    // subscription is processed rather than mistaken for a redelivery.
    const key = `${event}:${objectId}:${String(attrs.updated_at ?? "")}`.replace(/\//g, "_")

    if (!(await claimEvent(key))) {
        console.log(`[lemonsqueezy] ${event} for ${objectId} already applied, skipping`)
        return NextResponse.json({ ok: true, duplicate: true })
    }

    try {
        if (event === "order_created") {
            await handleOrder(payload)
        } else if (event === "order_refunded") {
            await handleOrderRefund(payload)
        } else if (GRANTING.has(event) || REVOKING.has(event) || INFORMATIONAL.has(event)) {
            await handleSubscription(event, payload)
        } else {
            console.log(`[lemonsqueezy] ignoring ${event}`)
        }

        return NextResponse.json({ ok: true })
    } catch (err) {
        // A 500 asks Lemon Squeezy to retry, which is what we want: a Firestore
        // write that failed once is exactly the case worth trying again. The
        // claim goes back first, or that retry would be dismissed as a
        // duplicate of the attempt that just failed.
        await releaseEvent(key)
        console.error(`[lemonsqueezy] failed to apply ${event} for ${objectId}`, err)
        return NextResponse.json({ error: "Could not apply this event." }, { status: 500 })
    }
}

/**
 * A one-off purchase, and the first event of a subscription's life.
 *
 * Both are handled the same way and both are safe, because grantPlan() only
 * moves an expiry forward. For a subscription this grants roughly the same
 * period the `subscription_created` event will confirm a moment later; for a
 * single payment it is the only event that will ever arrive.
 */
async function handleOrder(payload: Payload): Promise<void> {
    const attrs = payload.data?.attributes ?? {}
    const item = attrs.first_order_item as { variant_id?: string | number } | undefined

    if (attrs.status !== "paid") {
        console.log(`[lemonsqueezy] order ${payload.data?.id} is ${attrs.status}, not granting`)
        return
    }

    const mapped = item?.variant_id != null ? planForVariant(item.variant_id) : null
    if (!mapped) {
        console.warn(
            `[lemonsqueezy] order ${payload.data?.id} is for variant ${item?.variant_id}, ` +
            `which no LEMONSQUEEZY_VARIANT_* value matches — nothing granted`
        )
        return
    }

    const uid = await resolveUid(payload, null)
    if (!uid) {
        console.error(`[lemonsqueezy] order ${payload.data?.id} has no account to grant to`)
        return
    }

    const periodMs = mapped.cycle === "yearly" ? 365 * 864e5 : 30 * 864e5

    await grantPlan({
        uid,
        planId: mapped.planId,
        periodEnd: Date.now() + periodMs,
        subscription: {
            customerId: asId(attrs.customer_id),
            cycle: mapped.cycle,
            status: "active",
            // An order on its own does not renew. A subscription event will
            // arrive and correct this if there is one behind it.
            autoRenew: false,
        },
    })

    console.log(`[lemonsqueezy] order granted ${mapped.planId}/${mapped.cycle} to ${uid}`)
}

/**
 * A refunded one-off purchase.
 *
 * The mirror of handleOrder: order_created grants a plan, so its refund has to
 * take one back, or a fully refunded purchase keeps everything it paid for.
 * Only a whole refund counts — a partial one leaves the order still part-paid,
 * and ending the plan over it would punish a customer who got money back for a
 * discount or a tax correction.
 */
async function handleOrderRefund(payload: Payload): Promise<void> {
    const attrs = payload.data?.attributes ?? {}

    if (attrs.status !== "refunded") {
        console.log(
            `[lemonsqueezy] order ${payload.data?.id} is ${attrs.status} after a partial ` +
            `refund, leaving the plan alone`
        )
        return
    }

    const uid = await resolveUid(payload, null)
    if (!uid) {
        console.error(`[lemonsqueezy] refunded order ${payload.data?.id} has no account`)
        return
    }

    await revokePlan(uid, "order_refunded")
    console.log(`[lemonsqueezy] revoked plan for ${uid} after a refunded order`)
}

/**
 * How a paused subscription was set up, or null if it is not paused.
 *
 * Lemon Squeezy offers two kinds of pause and they mean opposite things for
 * access. "void" suspends the subscription — the customer is not billed and
 * should not have the plan. "free" keeps them on it for nothing, which is used
 * for goodwill and retention, and taking their plan away would be the wrong
 * thing entirely.
 *
 * Read from the attributes rather than from the event name, because a pause
 * also arrives on subscription_updated.
 */
function pauseMode(attrs: Record<string, unknown>): string | null {
    const pause = attrs.pause
    if (!pause || typeof pause !== "object") return null
    const mode = (pause as { mode?: unknown }).mode
    return typeof mode === "string" ? mode : null
}

async function handleSubscription(event: string, payload: Payload): Promise<void> {
    const eventAttrs = payload.data?.attributes ?? {}
    const isInvoice = INVOICE_EVENTS.has(event)

    // On an invoice event the subscription is named in the attributes; data.id
    // is the invoice. Everywhere else data.id is the subscription itself.
    const subscriptionId = isInvoice ? asId(eventAttrs.subscription_id) : asId(payload.data?.id)

    const uid = await resolveUid(payload, subscriptionId)
    if (!uid) {
        console.error(`[lemonsqueezy] ${event} for subscription ${subscriptionId} has no account`)
        return
    }

    if (INFORMATIONAL.has(event)) {
        const firstFailure = await recordPaymentFailure(uid, subscriptionId)
        if (firstFailure) await sendPaymentFailedNotice(uid)
        console.log(
            `[lemonsqueezy] ${event} for ${uid}: noted, plan left alone while ` +
            `Lemon Squeezy retries`
        )
        return
    }

    if (REVOKING.has(event)) {
        await revokePlan(uid, event)
        console.log(`[lemonsqueezy] revoked plan for ${uid} after ${event}`)
        return
    }

    // An invoice records that a payment happened, not what it bought or how
    // long it runs for, so the subscription behind it answers both. Fetched
    // rather than inferred: dating the next period "a month from today" off the
    // payment drifts away from the day Lemon Squeezy will actually bill on.
    let attrs: Record<string, unknown>
    if (isInvoice) {
        if (!subscriptionId) {
            console.warn(`[lemonsqueezy] ${event} carries no subscription_id`)
            return
        }
        // Thrown rather than swallowed: the money has already been taken, so a
        // failed read is worth the retry that a 500 asks for.
        const fetched = await fetchSubscriptionAttributes(subscriptionId)
        if (!fetched) throw new Error(`could not load subscription ${subscriptionId}`)
        attrs = fetched
    } else {
        attrs = eventAttrs
    }

    const status = typeof attrs.status === "string" ? attrs.status : ""

    // Checked against the subscription's status, never an invoice's: an
    // invoice's "paid" or "refunded" says nothing about whether the plan is
    // still running.
    // Checked before the status, because a paused subscription's status is
    // "paused" either way and only the mode says whether access goes with it.
    if (pauseMode(attrs) === "void") {
        await revokePlan(uid, `${event} (paused, void)`)
        console.log(`[lemonsqueezy] revoked plan for ${uid}: the subscription is paused`)
        return
    }

    if (DEAD_STATUSES.has(status)) {
        await revokePlan(uid, `${event} (${status})`)
        console.log(`[lemonsqueezy] revoked plan for ${uid}: the subscription is ${status}`)
        return
    }

    // Lemon Squeezy sends variant_id as a number in webhooks and a string in
    // API responses, and this now reads from both, so it is normalised rather
    // than compared as it arrives.
    const variantId = asId(attrs.variant_id)

    const mapped = variantId !== null ? planForVariant(variantId) : null
    if (!mapped) {
        console.warn(
            `[lemonsqueezy] subscription ${subscriptionId} is on variant ${variantId}, ` +
            `which no LEMONSQUEEZY_VARIANT_* value matches — nothing granted`
        )
        return
    }

    // ends_at is set once a subscription is cancelled and marks the last day
    // that was paid for; renews_at is the next billing date on a live one.
    // Taking ends_at first is what lets a cancelled customer keep the rest of
    // their period instead of losing it at the moment they cancel.
    const periodEnd = millis(attrs.ends_at) ?? millis(attrs.renews_at)

    if (periodEnd === null) {
        console.warn(
            `[lemonsqueezy] subscription ${subscriptionId} has neither ends_at nor renews_at`
        )
        return
    }

    await grantPlan({
        uid,
        planId: mapped.planId,
        periodEnd,
        subscription: {
            subscriptionId,
            customerId: asId(attrs.customer_id),
            variantId,
            status,
            cycle: mapped.cycle,
            autoRenew: status !== "cancelled" && status !== "paused",
            cancelledAt: attrs.cancelled === true ? millis(attrs.updated_at) : null,
            endsAt: millis(attrs.ends_at),
            renewsAt: millis(attrs.renews_at),
            testMode: payload.meta?.test_mode === true,
        },
    })

    console.log(
        `[lemonsqueezy] ${event}: ${uid} on ${mapped.planId}/${mapped.cycle} until ` +
        new Date(periodEnd).toISOString()
    )
}

/**
 * The one email a failing renewal sends. Respects the account's "Email
 * notifications" switch, like every other account notice.
 */
async function sendPaymentFailedNotice(uid: string): Promise<void> {
    const settings = `${getSiteUrl()}/settings`
    await notifyUser(uid, "account", {
        subject: "Your PDF AI Assistant payment didn't go through",
        text: [
            "We couldn't take the latest payment for your PDF AI Assistant subscription.",
            "Your plan is still active while the payment is retried over the next few days. " +
                "To keep it, update your card from Settings → Subscription & Billing → Manage subscription:",
            settings,
            "If the retries don't succeed, your account moves to the Free plan. " +
                "Nothing you've created is deleted.",
        ].join("\n\n"),
    }).catch((err) => console.error("[lemonsqueezy] could not send the payment notice", err))
}
