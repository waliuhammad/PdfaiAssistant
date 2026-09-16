import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { readDevPlanFromRequest } from "@/lib/dev-plan";
import { getRequestUid } from "@/lib/server-auth";
import {
    checkAndCountUsage,
    refundOperation,
    type UsageCategory,
    type UsageResult,
} from "@/lib/usage";
import type { PlanId } from "@/lib/plans";
import { withProcessingSlot } from "@/lib/priority";

/**
 * What metered() knows by the time the handler runs, and the handler would
 * otherwise have to work out again.
 *
 * The plan costs a Firestore read and a Remote Config read to resolve, and
 * checkAndCountUsage has just done both. Passing it on means the AI routes can
 * size-check the upload against the plan without repeating either — and it
 * honours the dev-plan override for free, which a second lookup would not.
 */
export interface MeteredContext {
    plan: PlanId;
}

/**
 * The shared gate for every metered tool route.
 *
 * Returns null when the request may proceed, or a ready-made refusal
 * response (401 signed out / 429 allowance exhausted). One call at the
 * top of a route replaces the blocks that would otherwise be repeated
 * across twenty files. The limit itself comes from the user's plan and the
 * client's Remote Config, inside checkAndCountUsage.
 */
export async function requireUsageAllowance(
    req: NextRequest,
    category: UsageCategory = "basic"
): Promise<NextResponse | null> {
    const uid = await getRequestUid(req);
    if (!uid) return signInRefusal();

    const devPlan = readDevPlanFromRequest(req);
    const usage = await checkAndCountUsage(uid, devPlan ?? undefined, category);
    if (!usage.allowed) return limitRefusal(usage);

    return null;
}

function signInRefusal(message = "Please sign in to use the tools."): NextResponse {
    return NextResponse.json(
        { success: false, error: message, message },
        { status: 401 }
    );
}

/** What each category is called when a refusal has to name it. */
const CATEGORY_LABEL: Record<string, string> = {
    advanced: "advanced PDF",
    ocr: "OCR",
    summary: "AI summary",
    grammar: "AI grammar & writing",
    translate: "AI translation",
};

function limitRefusal(usage: UsageResult): NextResponse {
    // Capped for the same reason the meter caps it: the day's counter can
    // outlive a larger allowance, and "12/5" reads as a fault rather than
    // a limit.
    const cap = (used: number, limit: number) => Math.min(used, limit);

    // Which ceiling stopped this matters to the person reading it. Someone told
    // "10 of 10 operations" when their single daily OCR is what ran out would
    // upgrade expecting more of the wrong thing.
    const hitCategory =
        usage.blockedBy !== "all" &&
        usage.blockedBy !== null &&
        usage.categoryLimit !== null &&
        usage.categoryUsed !== null;

    // A ceiling of zero is a plan that does not include the tool at all, not a
    // day's worth that has run out. "0/0 operations used" reads as a fault;
    // saying the plan does not include it explains what upgrading would buy.
    const notIncluded = hitCategory && usage.categoryLimit === 0;

    const message = notIncluded
        ? `This PDF tool is not included on the ${usage.plan} plan. Upgrade to use it.`
        : hitCategory
            ? `Daily ${CATEGORY_LABEL[usage.blockedBy as string] ?? usage.blockedBy} limit reached ` +
            `(${cap(usage.categoryUsed!, usage.categoryLimit!)}/${usage.categoryLimit} on the ${usage.plan} plan). ` +
            `Upgrade for a higher allowance, or come back tomorrow.`
            : `Daily limit reached (${cap(usage.used, usage.limit)}/${usage.limit} operations on the ${usage.plan} plan). ` +
            `Upgrade for a higher daily allowance, or come back tomorrow.`;

    return NextResponse.json({ success: false, error: message, message }, { status: 429 });
}

interface MeteredOptions {
    /** Wording for the 401, so the AI tools can name themselves. */
    signInMessage?: string;
    /**
     * Which allowance this route spends. Defaults to "basic", so a route that
     * says nothing keeps costing one from the daily total and nothing more —
     * the behaviour every route had before categories existed.
     */
    category?: UsageCategory;
}

/**
 * Wraps a route so its operation is only kept if the user got something back.
 *
 * The allowance used to be claimed at the top of each route and never
 * reconsidered, so an unreadable PDF, a failed conversion, a rejected password
 * or a cancelled request all spent an operation that produced no file. On a
 * 20-a-day plan, a few bad uploads could eat a quarter of the day's allowance
 * without the user ever receiving anything.
 *
 * The claim still happens first — check-then-increment has to be one atomic
 * step or simultaneous requests all pass the same check — but anything other
 * than a successful response gives it back, including a thrown error. So the
 * count follows the result the user actually receives.
 */
export function metered(
    // Response, not NextResponse: the tools that stream a file back build a
    // plain Response, and `ok` is all this needs from it.
    handler: (req: NextRequest, ctx: MeteredContext) => Promise<Response>,
    options: MeteredOptions = {}
): (req: NextRequest) => Promise<Response> {
    return async function meteredHandler(req: NextRequest): Promise<Response> {
        const uid = await getRequestUid(req);
        if (!uid) return signInRefusal(options.signInMessage);

        const category = options.category ?? "basic";
        const devPlan = readDevPlanFromRequest(req);
        const usage = await checkAndCountUsage(uid, devPlan ?? undefined, category);
        if (!usage.allowed) return limitRefusal(usage);

        let response: Response;
        try {
            // usage.plan, not devPlan: the override is null for every real
            // user, so passing it here would hand the handler `undefined` and
            // any plan-keyed lookup would come back empty — a size limit that
            // works while you are testing with the toggle on and silently
            // allows everything in production. checkAndCountUsage has already
            // applied the override, so this is the resolved plan either way.
            // Queued by plan when the server is busy — the "priority
            // processing" paid plans are sold with.
            response = await withProcessingSlot(usage.plan, () => handler(req, { plan: usage.plan }));
        } catch (err) {
            await refundOperation(uid, category);
            throw err;
        }

        // 4xx and 5xx mean no file was delivered, whatever the reason.
        if (!response.ok) await refundOperation(uid, category);

        return response;
    };
}