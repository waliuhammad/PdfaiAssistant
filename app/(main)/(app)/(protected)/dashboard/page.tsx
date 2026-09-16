"use client";
import { UsageMeter } from "@/components/usage-meter";
import { useT } from "@/components/locale-provider";
import Link from "next/link";
import { Wrench, Cpu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccount } from "@/hooks/useAccount";
import { usePlanUsage } from "@/hooks/usePlanUsage";
import { getPlan, type PlanId } from "@/lib/plans";
import { PaymentFailedBanner } from "@/components/account/payment-failed-banner";

/**
 * The dashboard, without a document library.
 *
 * It used to lead with Total Documents, Storage Used and Favourites over a
 * Recent Documents list — a whole page built on a library that never held
 * anything. Nothing was ever uploaded: the records were names and byte counts
 * in Firestore, the files themselves were dropped, and the "storage" the tiles
 * measured did not exist. All of it has gone rather than being left to imply a
 * feature the product does not have.
 *
 * What is left is what the account actually has: how much of today's allowance
 * is spent, and the way to the tools.
 */
const quickActions = [
    { key: "nav.tools", icon: Wrench, href: "/tools" },
    { key: "dashboard.aiTools", icon: Cpu, href: "/tools?category=AI%20Tools" },
] as const;

export default function DashboardPage() {
    // Route protection and the loading gate live in the (app) layout.
    const { user, profile } = useAuth();
    const { t } = useT();

    const displayName =
        profile?.fullName || user?.displayName || user?.email?.split("@")[0] || "there";
    // The plan the server resolved, which includes one held through a team.
    // Reading profile.plan here labelled every Pro and Business account "Free".
    const { usage } = usePlanUsage();
    const { account } = useAccount();
    const plan = (usage?.plan ?? account?.plan ?? null) as PlanId | null;
    const planLabel =
        plan === null ? null : plan === "free" ? t("dashboard.freePlan") : `${getPlan(plan).name} Plan`;

    return (
        <div>
            <PaymentFailedBanner failedAt={account?.paymentFailedAt} />

            <div className="mb-6 animate-tool-in">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h1 className="text-2xl font-bold text-fg">{t("dashboard.welcome")}, {displayName} 👋</h1>
                        <p className="text-muted text-sm mt-1">{t("dashboard.subtitle")}</p>
                    </div>
                    {planLabel && (
                        <span className="text-xs font-medium px-3 py-1.5 rounded-full bg-red-50 text-[var(--primary)] shrink-0">
                            {planLabel}
                            {account?.planSource === "team" && " · team"}
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* The allowance is the one number this page still has to report. */}
                <div className="bg-card border border-card rounded-2xl p-4 sm:p-6">
                    <UsageMeter hideHeader hideTitle />
                </div>

                <div className="bg-card border border-card rounded-2xl p-4 sm:p-6">
                    <h2 className="text-lg font-semibold text-fg mb-4">{t("dashboard.quickActions")}</h2>
                    <div className="space-y-2">
                        {quickActions.map((action) => {
                            const Icon = action.icon;

                            return (
                                <Link
                                    key={t(action.key)}
                                    href={action.href}
                                    className="flex items-center gap-3 p-3 rounded-xl border border-card hover:border-[var(--primary)] transition-colors"
                                >
                                    <Icon size={16} className="text-[var(--primary)]" />
                                    <span className="text-sm font-medium text-fg">{t(action.key)}</span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
