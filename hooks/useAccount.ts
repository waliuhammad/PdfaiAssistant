"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanId } from "@/lib/plans";

/** GET /api/account — the server's view of the signed-in account. */
export interface AccountSummary {
    plan: PlanId;
    planSource: "own" | "team";
    teamOwnerEmail: string | null;
    ownsTeam: boolean;
    planExpiresAt: number | null;
    paymentFailedAt: number | null;
    preferences: {
        language: string | null;
        notifications: { email: boolean; product: boolean; marketing: boolean };
    };
}

/**
 * The account as the server resolves it. The browser's own copy of the
 * profile cannot see a plan that comes from a team, or a failing renewal.
 */
export function useAccount() {
    const [account, setAccount] = useState<AccountSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/account", { cache: "no-store", signal: controller.signal })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                setAccount(data?.success ? (data as AccountSummary) : null);
                setLoading(false);
            })
            .catch((err) => {
                if ((err as Error)?.name === "AbortError") return;
                setLoading(false);
            });
        return () => controller.abort();
    }, [version]);

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    return { account, loading, reload };
}
