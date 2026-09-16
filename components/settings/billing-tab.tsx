"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useAccount } from "@/hooks/useAccount";
import { getPlan } from "@/lib/plans";
import { PaymentFailedBanner } from "@/components/account/payment-failed-banner";

/**
 * The Subscription & Billing panel in settings.
 *
 * Free users get a link to /pricing — upgrading starts there, where the
 * plans are actually explained. Paying users get "Manage subscription",
 * which asks the server for a portal URL: cancelling, changing card and
 * invoices all live on the payment provider's hosted portal, not here.
 *
 * The portal is Lemon Squeezy's. A customer whose plan did not come from a
 * card subscription has nothing to manage there, so the endpoint says which
 * case they are in and that message is shown as-is rather than guessed at.
 */
export function BillingTab() {
    // The server's answer, not the profile's: a Business plan held through a
    // team is not on the member's own document.
    const { account, loading } = useAccount();
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const planId = account?.plan ?? "free";
    const plan = getPlan(planId);
    const fromTeam = account?.planSource === "team";
    const isFree = planId === "free";

    const openPortal = async () => {
        setOpening(true);
        setError(null);

        try {
            const res = await fetch("/api/billing/portal", { method: "POST" });
            const data = await res.json().catch(() => null);

            if (res.ok && data?.url) {
                window.location.assign(data.url);
                return;
            }

            // The endpoint explains itself — no card subscription, expired
            // session, provider unreachable — so its message is preferred. The
            // fallback only covers a response that carried none.
            setError(data?.message ?? "Could not open the billing portal. Please try again.");
        } catch {
            setError("Could not reach the server. Please try again.");
        }

        setOpening(false);
    };

    if (loading) {
        return (
            <div className="max-w-md flex items-center gap-2 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" /> Loading your plan…
            </div>
        );
    }

    return (
        <div className="max-w-md">
            <h2 className="text-lg font-semibold text-fg mb-4">
                Subscription &amp; Billing
            </h2>

            <PaymentFailedBanner failedAt={account?.paymentFailedAt} showSettingsLink={false} />

            {/* Current plan */}
            <div className="p-5 rounded-xl border border-card mb-4">
                <p className="text-sm text-muted">Current plan</p>

                <div className="mt-1 flex items-baseline gap-2">
                    <p className="text-lg font-semibold text-fg">{plan.name}</p>
                    <p className="text-sm text-muted">
                        {isFree || fromTeam ? "" : `${plan.monthly}/month`}
                    </p>
                </div>

                {fromTeam && (
                    <p className="mt-1 text-xs text-muted">
                        Provided by your team{account?.teamOwnerEmail ? ` (${account.teamOwnerEmail})` : ""}.
                    </p>
                )}

                <ul className="mt-4 space-y-2.5">
                    {plan.features.map((feature) => (
                        <li
                            key={feature}
                            className="flex gap-2.5 text-xs md:text-sm text-muted"
                        >
                            <Check size={15} className="text-primary shrink-0" />
                            {feature}
                        </li>
                    ))}
                </ul>
            </div>

            {error && (
                <p className="mb-3 flex items-start gap-1.5 text-sm text-red-600">
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    {error}
                </p>
            )}

            {fromTeam ? (
                <p className="text-sm text-muted">
                    Your team owner manages this plan&apos;s billing.
                </p>
            ) : isFree ? (
                <Link
                    href="/pricing"
                    className="inline-block px-5 py-2.5 rounded-full bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] transition-colors"
                >
                    Upgrade Plan
                </Link>
            ) : (
                <button
                    onClick={openPortal}
                    disabled={opening}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
                >
                    {opening && <Loader2 size={15} className="animate-spin" />}
                    Manage subscription
                </button>
            )}
        </div>
    );
}