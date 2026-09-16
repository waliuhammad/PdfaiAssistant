import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { getAdminApp } from "@/lib/firebase/admin"
import type { BillingCycle, PlanId } from "@/lib/plans"
import { priceCentsFor } from "@/lib/plans"

const API = "https://api.lemonsqueezy.com/v1"

// Lemon Squeezy speaks JSON:API, which is picky about both of these.
const JSON_API = {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
} as const

function database(): Firestore {
    return getFirestore(getAdminApp())
}

export type PaidPlanId = Exclude<PlanId, "free">

const PAID_PLANS: PaidPlanId[] = ["pro", "business"]

// Variant ids rather than product ids: a Lemon Squeezy product holds every
// pricing option as a variant, and the monthly and yearly prices of one plan
// are two variants of the same product. Checking out against a product would
// make the customer pick the cycle again on Lemon Squeezy's page.
const VARIANT_ENV: Record<string, string> = {
    "pro:monthly": "LEMONSQUEEZY_VARIANT_PRO_MONTHLY",
    "pro:yearly": "LEMONSQUEEZY_VARIANT_PRO_YEARLY",
    "business:monthly": "LEMONSQUEEZY_VARIANT_BUSINESS_MONTHLY",
    "business:yearly": "LEMONSQUEEZY_VARIANT_BUSINESS_YEARLY",
}

function variantEnvKey(planId: PaidPlanId, cycle: BillingCycle): string {
    return VARIANT_ENV[`${planId}:${cycle}`]
}

export function variantFor(planId: PaidPlanId, cycle: BillingCycle): string | null {
    return process.env[variantEnvKey(planId, cycle)]?.trim() || null
}

/**
 * Which plan a webhook's variant id belongs to.
 *
 * Compared as strings after trimming because Lemon Squeezy sends variant ids as
 * JSON numbers in webhooks and as strings in API responses, and `123 === "123"`
 * is false. Getting this wrong means a real payment lands, the signature
 * verifies, and the plan is silently not granted.
 */
export function planForVariant(
    variantId: string | number
): { planId: PaidPlanId; cycle: BillingCycle } | null {
    const wanted = String(variantId).trim()

    for (const planId of PAID_PLANS) {
        for (const cycle of ["monthly", "yearly"] as BillingCycle[]) {
            if (variantFor(planId, cycle) === wanted) return { planId, cycle }
        }
    }
    return null
}

/** Why card payments are unusable, or null when they look right. */
export function lemonSqueezyProblem(): string | null {
    const missing = [
        !process.env.LEMONSQUEEZY_API_KEY?.trim() && "LEMONSQUEEZY_API_KEY",
        !process.env.LEMONSQUEEZY_STORE_ID?.trim() && "LEMONSQUEEZY_STORE_ID",
        !process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim() && "LEMONSQUEEZY_WEBHOOK_SECRET",
    ].filter(Boolean)

    if (missing.length) return `${missing.join(", ")} not set`

    const unset = PAID_PLANS.flatMap((planId) =>
        (["monthly", "yearly"] as BillingCycle[])
            .filter((cycle) => !variantFor(planId, cycle))
            .map((cycle) => variantEnvKey(planId, cycle))
    )

    if (unset.length === 4) return `no variant ids set (${unset.join(", ")})`

    return null
}

export function isLemonSqueezyConfigured(): boolean {
    return lemonSqueezyProblem() === null
}

/** True when this plan and cycle can actually be bought by card right now. */
export function canCheckout(planId: PaidPlanId, cycle: BillingCycle): boolean {
    return isLemonSqueezyConfigured() && variantFor(planId, cycle) !== null
}

async function lemonSqueezyFetch(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            ...JSON_API,
            Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY!.trim()}`,
            ...(init?.headers ?? {}),
        },
        cache: "no-store",
    })

    const body = await res.json().catch(() => null)

    if (!res.ok) {
        // Logged rather than returned to the browser: it can quote a store id
        // or a variant id, and a customer can do nothing with either.
        const detail =
            (body as { errors?: { detail?: string }[] } | null)?.errors?.[0]?.detail ??
            `HTTP ${res.status}`
        throw new Error(`Lemon Squeezy: ${detail}`)
    }

    return body
}

/**
 * Opens a hosted checkout and returns the URL to send the customer to.
 *
 * `custom: { user_id }` is the whole reason the webhook can do its job. Lemon
 * Squeezy echoes it back on every event for the resulting order and
 * subscription, so the payment arrives already attached to an account.
 *
 * Custom values must be strings — a number is silently dropped, and the webhook
 * then has a valid payment belonging to nobody.
 */
/**
 * Refuses to sell at a price the site did not advertise.
 *
 * The amount charged is whatever the Lemon Squeezy variant says, and the amount
 * shown is whatever lib/plans.ts says. Nothing kept the two in step, and they
 * had drifted the whole way apart: the store was billing $50 a month for the
 * plan advertised at $12.99, and $22 for the one advertised at $38.99 — Pro
 * dearer than Business, and every customer charged an amount they never agreed
 * to.
 *
 * Checked at the moment of sale rather than trusted, because the price lives in
 * someone else's dashboard and can be edited there without touching this repo.
 * A refused checkout is a lost sale; a completed one at the wrong price is a
 * chargeback and a complaint to a regulator.
 *
 * The detail goes in the thrown message so it reaches the server log. The
 * caller turns it into "payments are unavailable", which is what the customer
 * should see — the numbers are our problem, not theirs.
 */
async function assertPriceMatchesAdvertised(
    planId: PaidPlanId,
    cycle: BillingCycle,
    variantId: string
): Promise<void> {
    const advertised = priceCentsFor(planId, cycle)
    if (advertised === null) throw new Error(`no advertised price for ${planId}/${cycle}`)

    const body = (await lemonSqueezyFetch(`/variants/${variantId}`)) as {
        data?: { attributes?: { price?: number } }
    }
    const charged = body.data?.attributes?.price

    if (typeof charged !== "number") {
        throw new Error(`Lemon Squeezy variant ${variantId} reported no price`)
    }

    if (charged !== advertised) {
        throw new Error(
            `price mismatch for ${planId}/${cycle}: the site advertises ` +
            `$${(advertised / 100).toFixed(2)} but Lemon Squeezy variant ${variantId} ` +
            `charges $${(charged / 100).toFixed(2)} — refusing to take the payment`
        )
    }
}

export async function createCheckout(args: {
    uid: string
    email: string | null
    planId: PaidPlanId
    cycle: BillingCycle
    redirectUrl: string
}): Promise<string> {
    const variantId = variantFor(args.planId, args.cycle)
    if (!variantId) {
        throw new Error(`no Lemon Squeezy variant configured for ${args.planId}/${args.cycle}`)
    }

    await assertPriceMatchesAdvertised(args.planId, args.cycle, variantId)

    const payload = {
        data: {
            type: "checkouts",
            attributes: {
                checkout_data: {
                    ...(args.email ? { email: args.email } : {}),
                    custom: {
                        user_id: args.uid,
                        plan_id: args.planId,
                        cycle: args.cycle,
                    },
                },
                product_options: {
                    redirect_url: args.redirectUrl,
                    // Without this the checkout page offers every variant of the
                    // product, so someone who chose yearly here can quietly end
                    // up on monthly there.
                    enabled_variants: [Number(variantId)],
                },
                checkout_options: { embed: false },
            },
            relationships: {
                store: {
                    data: { type: "stores", id: String(process.env.LEMONSQUEEZY_STORE_ID).trim() },
                },
                variant: { data: { type: "variants", id: String(variantId) } },
            },
        },
    }

    const body = (await lemonSqueezyFetch("/checkouts", {
        method: "POST",
        body: JSON.stringify(payload),
    })) as { data?: { attributes?: { url?: string } } }

    const url = body?.data?.attributes?.url
    if (!url) throw new Error("Lemon Squeezy returned a checkout with no URL")

    return url
}

/**
 * Whether this request really came from Lemon Squeezy.
 *
 * HMAC-SHA256 of the raw body, hex, against the webhook secret. The *raw* body
 * matters: JSON.parse then JSON.stringify re-orders keys and drops whitespace,
 * so a re-serialised body never matches its own signature.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false

    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim()
    if (!secret) return false

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest()

    let received: Buffer
    try {
        received = Buffer.from(signature, "hex")
    } catch {
        return false
    }

    // timingSafeEqual throws on a length mismatch rather than returning false.
    if (received.length !== expected.length) return false

    return timingSafeEqual(received, expected)
}

/**
 * Grants a plan, or extends the one already held.
 *
 * Writes users/{uid} because that is the document every plan check reads —
 * resolvePlan() looks at `plan` and `planExpiresAt`, and nothing reads the
 * subscriptions collection. Same lesson confirmPayment() in payoneer.ts
 * records: a billing record that upgrades nobody is not an upgrade.
 *
 * The expiry only ever moves forward for the same plan. Lemon Squeezy retries
 * webhooks and can deliver them out of order, so a late `subscription_updated`
 * carrying last month's renewal date must not cut short a plan that has since
 * renewed. An actual downgrade goes through revokePlan().
 */
export async function grantPlan(args: {
    uid: string
    planId: PaidPlanId
    periodEnd: number
    subscription?: Record<string, unknown>
}): Promise<void> {
    const store = database()
    const userRef = store.collection("users").doc(args.uid)

    await store.runTransaction(async (tx) => {
        const snap = await tx.get(userRef)
        const current = snap.data() ?? {}

        const samePlan = current.plan === args.planId
        const existingEnd = typeof current.planExpiresAt === "number" ? current.planExpiresAt : 0
        const planExpiresAt = samePlan ? Math.max(existingEnd, args.periodEnd) : args.periodEnd

        tx.set(
            userRef,
            { plan: args.planId, planExpiresAt, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
        )

        if (args.subscription) {
            tx.set(
                store.collection("subscriptions").doc(args.uid),
                {
                    ...args.subscription,
                    provider: "lemonsqueezy",
                    planId: args.planId,
                    currentPeriodEnd: planExpiresAt,
                    // Money arrived, so whatever went wrong last time is over.
                    // Left set, a recovered subscriber would keep being told
                    // their payment had failed.
                    paymentFailedAt: null,
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            )
        }
    })
}

/**
 * Notes that a renewal payment failed, without touching the plan.
 *
 * Lemon Squeezy retries a failed renewal over several days before giving up,
 * and only then sends subscription_expired. Cutting access off at the first
 * failure would lock out a paying customer over an expired card they are about
 * to replace — so this records the problem and lets the retries run. If they
 * all fail, the expiry event revokes the plan through the usual path.
 *
 * Stored so the account can be told. A subscriber whose card is failing has a
 * few days to fix it and no way of knowing unless something says so.
 *
 * Returns true for the first failure of a run. Each retry sends the event
 * again, and the customer needs one email about it, not one per retry.
 */
export async function recordPaymentFailure(
    uid: string,
    subscriptionId: string | null
): Promise<boolean> {
    const store = database()
    const ref = store.collection("subscriptions").doc(uid)

    return store.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const alreadyFailing = typeof snap.data()?.paymentFailedAt === "number"

        tx.set(
            ref,
            {
                provider: "lemonsqueezy",
                ...(subscriptionId ? { subscriptionId } : {}),
                // The first failure is kept: it is when the problem started.
                ...(alreadyFailing ? {} : { paymentFailedAt: Date.now() }),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        )

        return !alreadyFailing
    })
}

/**
 * Ends a plan now — a refund, a chargeback, or a subscription that expired.
 *
 * Distinct from a cancellation. A customer who cancels keeps what they paid for
 * until `ends_at`, which is a grant with an expiry, not a revocation; calling
 * this on `subscription_cancelled` would take the plan away the moment they
 * clicked cancel, mid-period, having paid for it.
 */
export async function revokePlan(uid: string, reason: string): Promise<void> {
    const store = database()

    await store.collection("users").doc(uid).set(
        {
            plan: "free",
            // Not deleted: resolvePlan() treats a missing expiry as "predates
            // paid plans, leave alone", so removing the field would read as a
            // grandfathered account rather than a lapsed one.
            planExpiresAt: Date.now(),
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    )

    await store.collection("subscriptions").doc(uid).set(
        {
            provider: "lemonsqueezy",
            status: "expired",
            endedReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
    )
}

export interface StoredSubscription {
    subscriptionId: string | null
    customerId: string | null
    status: string | null
    planId: PlanId | null
    cycle: BillingCycle | null
    currentPeriodEnd: number | null
    autoRenew: boolean
    provider: string | null
    /** When a renewal payment last failed, while Lemon Squeezy retries it. */
    paymentFailedAt: number | null
}

export async function subscriptionFor(uid: string): Promise<StoredSubscription | null> {
    const snap = await database().collection("subscriptions").doc(uid).get()
    if (!snap.exists) return null

    const data = snap.data()!
    return {
        subscriptionId: (data.subscriptionId as string) ?? null,
        customerId: (data.customerId as string) ?? null,
        status: (data.status as string) ?? null,
        planId: (data.planId as PlanId) ?? null,
        cycle: (data.cycle as BillingCycle) ?? null,
        currentPeriodEnd: (data.currentPeriodEnd as number) ?? null,
        autoRenew: (data.autoRenew as boolean) ?? false,
        provider: (data.provider as string) ?? null,
        paymentFailedAt: (data.paymentFailedAt as number) ?? null,
    }
}

/**
 * A subscription's current attributes, read straight from the API.
 *
 * The invoice-shaped webhooks — `subscription_payment_success` and
 * `subscription_payment_refunded` — do not carry a subscription. Their `data`
 * is a subscription-invoice, holding a `subscription_id` and a payment status
 * but none of `variant_id`, `renews_at` or `ends_at`, which is everything
 * deciding a plan and its expiry actually needs. The webhook fetches the
 * subscription behind the invoice rather than guessing from the payment.
 */
export async function fetchSubscriptionAttributes(
    subscriptionId: string
): Promise<Record<string, unknown> | null> {
    const body = (await lemonSqueezyFetch(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`
    )) as { data?: { attributes?: Record<string, unknown> } }

    return body?.data?.attributes ?? null
}

/**
 * A fresh link to Lemon Squeezy's hosted portal.
 *
 * Fetched on demand rather than stored at webhook time: these URLs are signed
 * and expire after 24 hours, so a copy saved when the subscription was created
 * is a dead link by the second day — which is exactly when someone first goes
 * looking for it.
 */
export async function customerPortalUrl(uid: string): Promise<string | null> {
    const sub = await subscriptionFor(uid)
    if (!sub?.subscriptionId || sub.provider !== "lemonsqueezy") return null

    const attrs = await fetchSubscriptionAttributes(sub.subscriptionId)
    const urls = attrs?.urls as { customer_portal?: string } | undefined

    return urls?.customer_portal ?? null
}

/**
 * Cancels a subscription so it never renews. Lemon Squeezy keeps it active to
 * the end of the paid period; used when the account behind it is deleted,
 * so nobody is charged for an account that no longer exists.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
    await lemonSqueezyFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: "DELETE",
    })
}
