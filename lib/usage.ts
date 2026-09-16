import "server-only";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAdminApp, isAdminConfigured } from "@/lib/firebase/admin";
import type { UserProfile } from "@/lib/firebase/users";
import { resolveEffectivePlan } from "@/lib/teams";
import { getAppConfig, LIMITED_CATEGORIES, type LimitedCategory } from "@/lib/remote-config";
import type { PlanId } from "@/lib/plans";

/**
 * Daily usage limits, enforced per signed-in user.
 *
 * Each operation increments a counter document keyed by uid and date
 * (usage/{uid}_{YYYY-MM-DD}). The limit for the user's plan comes from
 * the client's Remote Config, so raising a plan's daily allowance in the
 * Firebase Console takes effect within minutes and without a deploy.
 *
 * The check and the increment happen in one Firestore transaction:
 * two requests racing on the last allowed operation can't both slip
 * through a read-then-write gap.
 */

/**
 * What an operation is charged against.
 *
 * "basic" costs one from the daily total and nothing else. Everything else
 * costs one from the total *and* one from its own ceiling, which is how the
 * pricing page can promise "50 operations per day" alongside "5 OCR operations
 * per day" without the two contradicting each other.
 */
export type UsageCategory = "basic" | LimitedCategory;

export interface UsageResult {
    allowed: boolean;
    /** The daily total, across every tool. */
    used: number;
    limit: number;
    plan: PlanId;
    /** Which allowance ran out. Null when the operation was allowed. */
    blockedBy: UsageCategory | "all" | null;
    /** The operation's own ceiling, or null for a basic tool. */
    category: LimitedCategory | null;
    categoryUsed: number | null;
    categoryLimit: number | null;
}

/** A category's counter field on the daily document. */
function fieldFor(category: LimitedCategory): string {
    return `count_${category}`;
}

function unmetered(plan: PlanId = "free"): UsageResult {
    return {
        allowed: true,
        used: 0,
        limit: Infinity,
        plan,
        blockedBy: null,
        category: null,
        categoryUsed: null,
        categoryLimit: null,
    };
}

/** Today's date in UTC, e.g. "2026-08-10" — the counter's reset boundary. */
function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export async function checkAndCountUsage(
    uid: string,
    devPlanOverride?: PlanId,
    category: UsageCategory = "basic"
): Promise<UsageResult> {
    // Limits unenforceable without admin credentials: fail open rather
    // than lock every tool because of a configuration problem.
    if (!isAdminConfigured()) {
        return unmetered();
    }

    const db = getFirestore(getAdminApp());

    // The user's plan decides which limit applies. During local testing,
    // the dev toggle can override what the server sees for the request.
    const profileSnap = await db.collection("users").doc(uid).get();
    const profile = (profileSnap.data() ?? null) as UserProfile | null;
    // Includes a Business plan held through a team, not only the account's own.
    const plan = devPlanOverride ?? (await resolveEffectivePlan(db, uid, profile)).plan;

    // The client's Remote Config supplies the number; monthly is the
    // reference cycle (their weekly/monthly/yearly values are identical
    // today, and the billing cycle isn't stored per-user yet).
    const { limits, categoryLimits } = await getAppConfig();
    const limit = limits.monthly[plan];

    const limited = category === "basic" ? null : category;
    const categoryLimit = limited ? categoryLimits[plan][limited] : null;

    const usageRef = db.collection("usage").doc(`${uid}_${todayKey()}`);

    return await db.runTransaction(async (tx) => {
        const snap = await tx.get(usageRef);
        const data = snap.data() ?? {};
        const used = (data.count as number | undefined) ?? 0;
        const categoryUsed = limited ? ((data[fieldFor(limited)] as number | undefined) ?? 0) : null;

        const base = { used, limit, plan, category: limited, categoryUsed, categoryLimit };

        // The category is checked first so the refusal names the ceiling the
        // user actually hit. Told "10 of 10 operations" when it was really the
        // single daily OCR that ran out, they would upgrade expecting more OCR
        // and get the same wall.
        if (limited && categoryUsed !== null && categoryLimit !== null && categoryUsed >= categoryLimit) {
            return { ...base, allowed: false, blockedBy: limited };
        }

        if (used >= limit) {
            return { ...base, allowed: false, blockedBy: "all" as const };
        }

        tx.set(
            usageRef,
            {
                uid,
                date: todayKey(),
                count: FieldValue.increment(1),
                ...(limited ? { [fieldFor(limited)]: FieldValue.increment(1) } : {}),
            },
            { merge: true }
        );

        return {
            ...base,
            allowed: true,
            blockedBy: null,
            used: used + 1,
            categoryUsed: categoryUsed === null ? null : categoryUsed + 1,
        };
    });
}

/**
 * Give back an operation that produced nothing.
 *
 * The allowance is claimed before the work starts, because that is the only
 * point where the check and the increment can be one atomic step — without it,
 * requests fired together would all read the same count and all pass. The cost
 * is that a failure, a rejected file or a cancelled conversion spent an
 * operation the user never got a result from. This returns it.
 *
 * Floored at zero inside the transaction: a refund that arrives after the day
 * has rolled over, or twice for one claim, must not push the counter negative
 * and hand out free operations tomorrow.
 */
export async function refundOperation(uid: string, category: UsageCategory = "basic"): Promise<void> {
    if (!isAdminConfigured()) return;

    const db = getFirestore(getAdminApp());
    const usageRef = db.collection("usage").doc(`${uid}_${todayKey()}`);
    const limited = category === "basic" ? null : category;

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(usageRef);
            const data = snap.data() ?? {};
            const used = (data.count as number | undefined) ?? 0;
            const categoryUsed = limited ? ((data[fieldFor(limited)] as number | undefined) ?? 0) : 0;

            // Both counters were charged, so both are given back — refunding
            // only the total would leave the category permanently short, and
            // a few failed OCR attempts would exhaust the day's OCR allowance
            // without ever producing a result.
            const patch: Record<string, unknown> = { uid, date: todayKey() };
            if (used > 0) patch.count = used - 1;
            if (limited && categoryUsed > 0) patch[fieldFor(limited)] = categoryUsed - 1;

            if (Object.keys(patch).length === 2) return;

            tx.set(usageRef, patch, { merge: true });
        });
    } catch (err) {
        // A failed refund must not turn a tool error into a second error for
        // the user; the worst case is one operation they did not receive.
        console.error("Could not refund an operation:", err);
    }
}

/** Read-only variant for showing "X of Y used today" without consuming one. */
export async function peekUsage(
    uid: string,
    devPlanOverride?: PlanId,
    category: UsageCategory = "basic"
): Promise<UsageResult> {
    if (!isAdminConfigured()) {
        return unmetered();
    }

    const db = getFirestore(getAdminApp());

    const profileSnap = await db.collection("users").doc(uid).get();
    const plan =
        devPlanOverride ??
        (await resolveEffectivePlan(db, uid, (profileSnap.data() ?? null) as UserProfile | null)).plan;

    const { limits, categoryLimits } = await getAppConfig();
    const limit = limits.monthly[plan];

    const limited = category === "basic" ? null : category;
    const categoryLimit = limited ? categoryLimits[plan][limited] : null;

    const snap = await db.collection("usage").doc(`${uid}_${todayKey()}`).get();
    const data = snap.data() ?? {};
    const used = (data.count as number | undefined) ?? 0;
    const categoryUsed = limited ? ((data[fieldFor(limited)] as number | undefined) ?? 0) : null;

    const withinCategory =
        categoryUsed === null || categoryLimit === null || categoryUsed < categoryLimit;

    return {
        allowed: used < limit && withinCategory,
        used,
        limit,
        plan,
        blockedBy: null,
        category: limited,
        categoryUsed,
        categoryLimit,
    };
}

/**
 * Every allowance at once, for the meter rather than for a decision.
 *
 * One Firestore read and one config read cover all six numbers; asking
 * peekUsage per category would repeat both five more times to build the same
 * answer.
 */
export interface UsageBreakdown {
    plan: PlanId;
    used: number;
    limit: number;
    categories: Record<LimitedCategory, { used: number; limit: number }>;
}

export async function peekUsageBreakdown(
    uid: string,
    devPlanOverride?: PlanId
): Promise<UsageBreakdown> {
    const empty = () =>
        Object.fromEntries(
            LIMITED_CATEGORIES.map((c) => [c, { used: 0, limit: Infinity }])
        ) as UsageBreakdown["categories"];

    if (!isAdminConfigured()) {
        return { plan: "free", used: 0, limit: Infinity, categories: empty() };
    }

    const db = getFirestore(getAdminApp());

    const profileSnap = await db.collection("users").doc(uid).get();
    const plan =
        devPlanOverride ??
        (await resolveEffectivePlan(db, uid, (profileSnap.data() ?? null) as UserProfile | null)).plan;

    const { limits, categoryLimits } = await getAppConfig();
    const snap = await db.collection("usage").doc(`${uid}_${todayKey()}`).get();
    const data = snap.data() ?? {};

    return {
        plan,
        used: (data.count as number | undefined) ?? 0,
        limit: limits.monthly[plan],
        categories: Object.fromEntries(
            LIMITED_CATEGORIES.map((c) => [
                c,
                {
                    used: (data[fieldFor(c)] as number | undefined) ?? 0,
                    limit: categoryLimits[plan][c],
                },
            ])
        ) as UsageBreakdown["categories"],
    };
}