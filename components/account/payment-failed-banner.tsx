"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Shown while a renewal payment is failing and Lemon Squeezy is retrying it.
 * The plan is still active; this is the warning that it will not stay so
 * unless the card is fixed.
 */
export function PaymentFailedBanner({
    failedAt,
    showSettingsLink = true,
}: {
    failedAt: number | null | undefined;
    showSettingsLink?: boolean;
}) {
    if (!failedAt) return null;

    const since = new Date(failedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
    });

    return (
        <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
                <p className="font-medium">Your last payment didn&apos;t go through ({since}).</p>
                <p className="mt-1">
                    Your plan is still active while we retry. Update your card to keep it
                    {showSettingsLink ? (
                        <>
                            {" "}—{" "}
                            <Link href="/settings?tab=billing" className="font-medium underline">
                                manage subscription
                            </Link>
                            .
                        </>
                    ) : (
                        " using Manage subscription below."
                    )}
                </p>
            </div>
        </div>
    );
}
