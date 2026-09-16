import { NextRequest, NextResponse } from "next/server";
import { FieldPath, FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAdminApp, getAdminAuth, isAdminConfigured, SESSION_COOKIE } from "@/lib/firebase/admin";
import { getRequestUid } from "@/lib/server-auth";
import { SESSION_HINT_COOKIE } from "@/lib/session-hint";
import { readDevPlanFromRequest } from "@/lib/dev-plan";
import type { UserProfile } from "@/lib/firebase/users";
import { dissolveTeam, removeMember, resolveEffectivePlan, teamRef, type TeamDoc } from "@/lib/teams";
import { readNotificationPrefs, sendEmail } from "@/lib/email";
import { cancelSubscription, subscriptionFor } from "@/lib/billing/lemonsqueezy";
import { rateLimit } from "@/lib/rate-limit";
import { forgetSession } from "@/lib/session-verify";

/**
 * The signed-in account, as the server sees it.
 *
 * GET answers the questions the browser cannot answer from its own copy of the
 * profile: which plan actually applies (a team member's Business plan is not
 * on their own document), whether a renewal is failing, and what the stored
 * notification settings are.
 *
 * DELETE removes the account and everything kept against it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function database(): Firestore {
    return getFirestore(getAdminApp());
}

function unavailable() {
    return NextResponse.json(
        { success: false, message: "Your account is not available right now." },
        { status: 503 }
    );
}

function signedOut() {
    return NextResponse.json({ success: false, message: "Sign in to continue." }, { status: 401 });
}

export async function GET(req: NextRequest) {
    if (!isAdminConfigured()) return unavailable();

    const uid = await getRequestUid(req);
    if (!uid) return signedOut();

    try {
        const db = database();
        const snap = await db.collection("users").doc(uid).get();
        const profile = (snap.data() ?? null) as (UserProfile & Record<string, unknown>) | null;

        const [effective, subscription, ownTeam] = await Promise.all([
            resolveEffectivePlan(db, uid, profile),
            subscriptionFor(uid),
            teamRef(db, uid).get(),
        ]);

        const devPlan = readDevPlanFromRequest(req);
        const prefs = (profile?.preferences ?? {}) as Record<string, unknown>;

        let teamOwnerEmail: string | null = null;
        if (effective.teamId && effective.teamId !== uid) {
            const team = (await teamRef(db, effective.teamId).get()).data() as TeamDoc | undefined;
            teamOwnerEmail = team?.ownerEmail ?? null;
        }

        return NextResponse.json({
            success: true,
            plan: devPlan ?? effective.plan,
            planSource: devPlan ? "own" : effective.source,
            teamOwnerEmail,
            ownsTeam: ownTeam.exists,
            planExpiresAt: typeof profile?.planExpiresAt === "number" ? profile.planExpiresAt : null,
            // Only while the subscription is still live: a failure on a
            // subscription that has since ended is history, not a warning.
            paymentFailedAt:
                subscription?.paymentFailedAt && subscription.status !== "expired"
                    ? subscription.paymentFailedAt
                    : null,
            preferences: {
                language: typeof prefs.language === "string" ? prefs.language : null,
                notifications: readNotificationPrefs(prefs.notifications),
            },
        });
    } catch (err) {
        console.error("[account] could not read the account", err);
        return NextResponse.json(
            { success: false, message: "Could not load your account. Please try again." },
            { status: 500 }
        );
    }
}

/** How recent a sign-in has to be before the account can be deleted. */
const RECENT_SIGN_IN_S = 5 * 60;

/**
 * Deletes the account.
 *
 * The session cookie alone is not enough: it lasts days, and a borrowed laptop
 * with a signed-in tab should not be able to erase someone. The browser signs
 * in again first and sends the fresh ID token, which must belong to the same
 * account and be minutes old.
 *
 * Order matters. The subscription is cancelled before anything is deleted, so a
 * failure there stops the deletion rather than leaving a card being charged for
 * an account that is gone. The auth user goes last, so a failure part-way
 * leaves an account the person can still sign in to and delete again.
 */
export async function DELETE(req: NextRequest) {
    if (!isAdminConfigured()) return unavailable();

    const uid = await getRequestUid(req);
    if (!uid) return signedOut();

    const limited = rateLimit(req, { name: "account-delete", limit: 5, windowMs: 10 * 60 * 1000 });
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    if (body?.confirm !== "DELETE" || typeof body?.idToken !== "string") {
        return NextResponse.json(
            { success: false, message: "Type DELETE to confirm." },
            { status: 400 }
        );
    }

    try {
        const decoded = await getAdminAuth().verifyIdToken(body.idToken, true);
        const age = Math.floor(Date.now() / 1000) - decoded.auth_time;
        if (decoded.uid !== uid || age > RECENT_SIGN_IN_S) throw new Error("stale");
    } catch {
        return NextResponse.json(
            { success: false, message: "Please confirm it's you again, then retry." },
            { status: 401 }
        );
    }

    const db = database();
    const auth = getAdminAuth();

    let email: string | null = null;
    try {
        email = (await auth.getUser(uid)).email ?? null;
    } catch {
        // Carry on: the address is only for the confirmation email.
    }

    // 1. Stop the billing.
    try {
        const sub = await subscriptionFor(uid);
        const live = !["cancelled", "expired"].includes(sub?.status ?? "");
        if (sub?.provider === "lemonsqueezy" && sub.subscriptionId && live) {
            await cancelSubscription(sub.subscriptionId);
        }
    } catch (err) {
        console.error(`[account] could not cancel the subscription for ${uid}`, err);
        return NextResponse.json(
            {
                success: false,
                message:
                    "We couldn't cancel your subscription, so your account was not deleted. " +
                    "Please try again, or cancel it from Manage subscription first.",
            },
            { status: 502 }
        );
    }

    try {
        // Written first, so billing events that arrive from here on are
        // ignored instead of recreating the account.
        await db.collection("deletedAccounts").doc(uid).set({
            deletedAt: FieldValue.serverTimestamp(),
        });

        // 2. Teams: an owner's team ends; a member leaves theirs.
        const profile = (await db.collection("users").doc(uid).get()).data();
        await dissolveTeam(db, uid);
        if (typeof profile?.teamId === "string" && profile.teamId !== uid) {
            await removeMember(db, profile.teamId, uid);
        }
        if (email) {
            const invites = await db
                .collection("teamInvites")
                .where("email", "==", email.toLowerCase())
                .get();
            await Promise.all(invites.docs.map((d) => d.ref.delete()));
        }

        // 3. The rating, taken out of the public average in the same step.
        await deleteRating(db, uid);

        // 4. Usage counters — ids are `${uid}_${date}`.
        const usage = await db
            .collection("usage")
            .where(FieldPath.documentId(), ">=", `${uid}_`)
            .where(FieldPath.documentId(), "<", `${uid}_`)
            .get();
        await Promise.all(usage.docs.map((d) => d.ref.delete()));

        // 5. The profile and everything under it, and the billing record.
        await db.recursiveDelete(db.collection("users").doc(uid));
        await db.collection("subscriptions").doc(uid).delete();

        // 6. The sign-in itself.
        await auth.deleteUser(uid);
    } catch (err) {
        console.error(`[account] deletion of ${uid} did not finish`, err);
        // The account still exists, so its billing events must apply again.
        await db.collection("deletedAccounts").doc(uid).delete().catch(() => { });
        return NextResponse.json(
            { success: false, message: "We couldn't finish deleting your account. Please try again." },
            { status: 500 }
        );
    }

    if (email) {
        await sendEmail({
            to: email,
            subject: "Your PDF AI Assistant account has been deleted",
            text: [
                "Your PDF AI Assistant account and the data stored with it have been deleted.",
                "Any subscription was cancelled, so you will not be charged again.",
                "If you didn't ask for this, reply to this email.",
            ].join("\n\n"),
        });
    }

    const current = req.cookies.get(SESSION_COOKIE)?.value;
    if (current) forgetSession(current);

    const response = NextResponse.json({ success: true });
    for (const name of [SESSION_COOKIE, SESSION_HINT_COOKIE]) {
        response.cookies.set({ name, value: "", path: "/", maxAge: 0 });
    }
    return response;
}

async function deleteRating(db: Firestore, uid: string): Promise<void> {
    const ratingRef = db.collection("ratings").doc(uid);
    const statsRef = db.collection("stats").doc("ratings");

    await db.runTransaction(async (tx) => {
        const [ratingSnap, statsSnap] = await Promise.all([tx.get(ratingRef), tx.get(statsRef)]);
        const rating = ratingSnap.data()?.rating;
        if (!ratingSnap.exists) return;

        if (typeof rating === "number") {
            const stats = statsSnap.data() ?? {};
            const totalCount = Math.max(0, (Number(stats.totalCount) || 0) - 1);
            const ratingSum = Math.max(0, (Number(stats.ratingSum) || 0) - rating);
            tx.set(
                statsRef,
                {
                    totalCount,
                    ratingSum: totalCount > 0 ? ratingSum : 0,
                    avgRating: totalCount > 0 ? ratingSum / totalCount : 0,
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
            );
        }

        tx.delete(ratingRef);
    });
}
