import "server-only";
import type { PlanId } from "@/lib/plans";

/**
 * Priority processing: when the server is busy, paid work starts first.
 *
 * Every metered tool runs through a fixed number of slots. While a slot is
 * free nothing waits and the plan makes no difference. Once they are all
 * taken, requests queue, and the next free slot goes to the highest plan in
 * the queue — Business, then Pro, then Free — first come first served within a
 * plan.
 *
 * A free request is never starved: the longer it waits the more its priority
 * grows, and after STARVATION_MS it is treated as top priority. Busy periods
 * make free users wait longer, they do not make them wait forever.
 *
 * In memory, for the same reason as the rate limiter: this runs as one
 * container, and the queue only has to describe the requests in flight on it.
 */

const SLOTS = Math.max(1, Number(process.env.PROCESSING_SLOTS) || 4);
const STARVATION_MS = 20_000;

const RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

interface Waiter {
    rank: number;
    since: number;
    wake: () => void;
}

let running = 0;
const queue: Waiter[] = [];

function effectiveRank(w: Waiter, now: number): number {
    // Aged past the threshold, a waiter outranks every plan.
    return now - w.since >= STARVATION_MS ? RANK.business + 1 : w.rank;
}

function next(): Waiter | undefined {
    if (queue.length === 0) return undefined;
    const now = Date.now();
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
        const a = effectiveRank(queue[i], now);
        const b = effectiveRank(queue[best], now);
        // Strictly greater, so equal ranks keep arrival order.
        if (a > b) best = i;
    }
    return queue.splice(best, 1)[0];
}

function release(): void {
    const waiter = next();
    if (waiter) {
        // The slot passes straight to the waiter; `running` is unchanged.
        waiter.wake();
    } else {
        running--;
    }
}

/** Runs `work` in a processing slot, queueing by plan when all are busy. */
export async function withProcessingSlot<T>(plan: PlanId, work: () => Promise<T>): Promise<T> {
    if (running < SLOTS) {
        running++;
    } else {
        await new Promise<void>((wake) => {
            queue.push({ rank: RANK[plan], since: Date.now(), wake });
        });
    }

    try {
        return await work();
    } finally {
        release();
    }
}

/** For the health check: how busy processing is right now. */
export function processingLoad(): { slots: number; running: number; queued: number } {
    return { slots: SLOTS, running, queued: queue.length };
}
