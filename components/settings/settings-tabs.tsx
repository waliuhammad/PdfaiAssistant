"use client";

import { User, Palette, Bell, Lock, Globe, CreditCard, Users } from "lucide-react";
import { useT } from "@/components/locale-provider";

export type SettingsTab = "profile" | "theme" | "notifications" | "password" | "language" | "billing" | "team";

const tabs = [
    { id: "profile", key: "settings.profile", icon: User },
    { id: "theme", key: "settings.theme", icon: Palette },
    { id: "notifications", key: "settings.notifications", icon: Bell },
    { id: "password", key: "settings.password", icon: Lock },
    { id: "language", key: "settings.language", icon: Globe },
    { id: "billing", key: "settings.billing", icon: CreditCard },
    { id: "team", key: "settings.team", icon: Users },
] as const;

export function SettingsTabs({ active, onChange }: { active: SettingsTab; onChange: (tab: SettingsTab) => void }) {
    const { t } = useT();

    return (
        // Seven full-width buttons stacked on a phone pushed the actual settings
        // ~250px down the page. They scroll in one row there — the same pattern
        // as the tools category filter — and become the vertical sidebar at md.
        <div className="w-full md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => onChange(tab.id)}
                    className={`w-auto md:w-full shrink-0 whitespace-nowrap flex items-center gap-2 md:gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${active === tab.id
                        ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "text-muted hover:bg-[var(--background-secondary)] hover:text-fg"
                        }`}
                >
                    <tab.icon size={17} />
                    {t(tab.key)}
                </button>
            ))}
        </div>
    );
}