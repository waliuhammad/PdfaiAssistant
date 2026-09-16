"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { SettingsTabs, SettingsTab } from "@/components/settings/settings-tabs";
import { Sun, Moon, Monitor, Check, AlertCircle, Loader2, ChevronDown, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { LOCALE_CHANGED_EVENT, useT } from "@/components/locale-provider";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n/messages";
import { updateUserProfile } from "@/lib/firebase/users";
import { changePassword, hasPasswordProvider } from "@/lib/firebase/auth";
import { BillingTab } from "@/components/settings/billing-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { DeleteAccount } from "@/components/settings/delete-account";
import { useAccount } from "@/hooks/useAccount";

type Status =
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "warning"; message: string }
    | { kind: "error"; message: string };

type NotificationKey = "email" | "product" | "marketing";

const PREFS_STORAGE_KEY = "pdfai:preferences";

interface Preferences {
    language: string;
    notifications: Record<NotificationKey, boolean>;
}

const TAB_IDS: SettingsTab[] = ["profile", "theme", "notifications", "password", "language", "billing", "team"];

const DEFAULT_PREFS: Preferences = {
    language: "en",
    notifications: { email: true, product: true, marketing: false },
};

// The languages offered are exactly the ones with a catalogue, so every
// entry in this list actually changes the interface.
const WORLD_LANGUAGES = SUPPORTED_LANGUAGES;

function loadPreferences(): Preferences {
    if (typeof window === "undefined") return DEFAULT_PREFS;
    try {
        const stored = localStorage.getItem(PREFS_STORAGE_KEY);
        return stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : DEFAULT_PREFS;
    } catch {
        // Corrupt or unavailable storage — fall back to defaults.
        return DEFAULT_PREFS;
    }
}

function StatusMessage({ status, savedLabel }: { status: Status; savedLabel: string }) {
    if (status.kind === "saved") {
        return (
            <p className="flex items-center gap-1.5 text-sm text-green-600">
                <Check size={15} /> {savedLabel}
            </p>
        );
    }
    if (status.kind === "warning") {
        return (
            <p className="flex items-start gap-1.5 text-sm text-amber-600">
                <AlertCircle size={15} className="shrink-0 mt-0.5" /> {status.message}
            </p>
        );
    }
    if (status.kind === "error") {
        return (
            <p className="flex items-start gap-1.5 text-sm text-red-600">
                <AlertCircle size={15} className="shrink-0 mt-0.5" /> {status.message}
            </p>
        );
    }
    return null;
}

export default function SettingsPage() {
    const { user, profile } = useAuth();
    const { theme, setTheme } = useTheme();
    const { t } = useT();
    // ?tab= lets other pages link straight to a panel (the payment banner
    // links to billing).
    const searchParams = useSearchParams();
    const [tab, setTab] = useState<SettingsTab>(() => {
        const requested = searchParams.get("tab");
        return TAB_IDS.includes(requested as SettingsTab) ? (requested as SettingsTab) : "profile";
    });

    // Profile. The draft stays null until the field is edited, so a late-arriving
    // auth profile fills the input without an effect syncing state to props.
    const [nameDraft, setNameDraft] = useState<string | null>(null);
    const [profileStatus, setProfileStatus] = useState<Status>({ kind: "idle" });
    const name = nameDraft ?? profile?.fullName ?? user?.displayName ?? "";

    // Password
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordStatus, setPasswordStatus] = useState<Status>({ kind: "idle" });

    // The language is also kept in this browser, where the locale provider
    // reads it. The email switches live on the account: the server decides what
    // is sent, so its copy is the one shown once it has loaded.
    const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
    const { account } = useAccount();
    const [notificationDraft, setNotificationDraft] = useState<Preferences["notifications"] | null>(null);
    const [notificationStatus, setNotificationStatus] = useState<Status>({ kind: "idle" });
    const notifications = notificationDraft ?? account?.preferences.notifications ?? null;

    // Language Dropdown State
    const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
    const [langSearch, setLangSearch] = useState("");
    const langDropdownRef = useRef<HTMLDivElement>(null);

    // Close language dropdown if user clicks outside of it
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (langDropdownRef.current && !langDropdownRef.current.contains(event.target as Node)) {
                setIsLangDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const saveToAccount = async (body: Record<string, unknown>): Promise<boolean> => {
        try {
            const res = await fetch("/api/account/preferences", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            return res.ok;
        } catch {
            return false;
        }
    };

    const saveNotifications = async (next: Preferences["notifications"]) => {
        const previous = notifications;
        setNotificationDraft(next);
        setNotificationStatus({ kind: "saving" });
        const ok = await saveToAccount({ notifications: next });
        if (ok) {
            setNotificationStatus({ kind: "saved" });
        } else {
            setNotificationDraft(previous);
            setNotificationStatus({ kind: "error", message: "Couldn't save that change. Please try again." });
        }
    };

    const savePreferences = (next: Preferences) => {
        if (next.language !== prefs.language) void saveToAccount({ language: next.language });
        setPrefs(next);
        try {
            localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
            // Writing to localStorage does not fire "storage" in the tab that
            // wrote it, so the provider is told directly. Without this the
            // language only changed after a reload.
            window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT));
        } catch {
            // Storage unavailable (private mode) — the in-memory value still applies.
        }
    };

    const handleSaveProfile = async () => {
        if (!user) return;
        if (!name.trim()) {
            setProfileStatus({ kind: "error", message: "Name can't be empty." });
            return;
        }

        setProfileStatus({ kind: "saving" });
        try {
            const { syncedToDatabase } = await updateUserProfile(user, name.trim());
            setProfileStatus(
                syncedToDatabase
                    ? { kind: "saved" }
                    : {
                        kind: "warning",
                        message: "Name updated, but it couldn't be saved to your profile record.",
                    }
            );
        } catch (err) {
            setProfileStatus({
                kind: "error",
                message: err instanceof Error ? err.message : "Could not save your profile.",
            });
        }
    };

    const handleChangePassword = async () => {
        if (newPassword.length < 8) {
            setPasswordStatus({ kind: "error", message: "New password must be at least 8 characters." });
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordStatus({ kind: "error", message: "New passwords do not match." });
            return;
        }

        setPasswordStatus({ kind: "saving" });
        try {
            await changePassword(currentPassword, newPassword);
            setPasswordStatus({ kind: "saved" });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err) {
            const code = (err as { code?: string })?.code;
            const message =
                code === "auth/wrong-password" || code === "auth/invalid-credential"
                    ? "Your current password is incorrect."
                    : code === "auth/too-many-requests"
                        ? "Too many attempts. Try again later."
                        : err instanceof Error
                            ? err.message
                            : "Could not update your password.";
            setPasswordStatus({ kind: "error", message });
        }
    };

    const inputClass =
        "w-full px-4 py-2.5 rounded-xl border border-card text-fg bg-card focus:outline-none focus:border-[var(--primary)] transition-colors";
    const buttonClass =
        "px-5 py-2.5 rounded-full bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2";

    const canUsePassword = hasPasswordProvider(user);

    // Derived Language Values
    const filteredLanguages = WORLD_LANGUAGES.filter(lang =>
        lang.name.toLowerCase().includes(langSearch.toLowerCase())
    );
    const selectedLanguageName = WORLD_LANGUAGES.find(l => l.code === prefs.language)?.name || "Select Language";

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-fg">Settings</h1>
                <p className="text-muted text-sm mt-1">Manage your account and preferences.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-6">
                <SettingsTabs active={tab} onChange={setTab} />

                <div className="flex-1 bg-card border border-card rounded-2xl p-6">
                    {tab === "profile" && (
                        <div className="space-y-4 max-w-md">
                            <h2 className="text-lg font-semibold text-fg mb-4">Profile</h2>
                            <div>
                                <label htmlFor="fullName" className="block text-sm font-medium text-fg mb-1.5">
                                    Full name
                                </label>
                                <input
                                    id="fullName"
                                    value={name}
                                    onChange={(e) => {
                                        setNameDraft(e.target.value);
                                        setProfileStatus({ kind: "idle" });
                                    }}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-fg mb-1.5">
                                    Email
                                </label>
                                <input
                                    id="email"
                                    value={user?.email ?? ""}
                                    readOnly
                                    disabled
                                    className={`${inputClass} opacity-60 cursor-not-allowed`}
                                />
                                <p className="text-xs text-muted mt-1.5">
                                    Your email is tied to your sign-in and can&apos;t be changed here.
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleSaveProfile}
                                    disabled={profileStatus.kind === "saving" || !user}
                                    className={buttonClass}
                                >
                                    {profileStatus.kind === "saving" && <Loader2 size={15} className="animate-spin" />}
                                    {profileStatus.kind === "saving" ? "Saving..." : "Save Changes"}
                                </button>
                                <StatusMessage status={profileStatus} savedLabel="Profile updated" />
                            </div>

                            <DeleteAccount />
                        </div>
                    )}

                    {tab === "theme" && (
                        <div className="max-w-md">
                            <h2 className="text-lg font-semibold text-fg mb-4">Theme</h2>
                            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                                {[
                                    { id: "light", label: "Light", icon: Sun },
                                    { id: "dark", label: "Dark", icon: Moon },
                                    { id: "system", label: "System", icon: Monitor },
                                ].map((opt) => {
                                    const active = theme === opt.id;

                                    return (
                                        <button
                                            key={opt.id}
                                            onClick={() => setTheme(opt.id as "light" | "dark" | "system")}
                                            className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${active ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-card"
                                                }`}
                                        >
                                            <opt.icon size={20} className={active ? "text-[var(--primary)]" : "text-muted"} />
                                            <span className="text-sm text-fg">{opt.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {tab === "notifications" && (
                        <div className="max-w-md space-y-4">
                            <h2 className="text-lg font-semibold text-fg mb-4">Notifications</h2>
                            {[
                                { key: "email" as const, label: "Email notifications", desc: "Receive updates about your account" },
                                { key: "product" as const, label: "Product updates", desc: "New features and improvements" },
                                { key: "marketing" as const, label: "Marketing emails", desc: "Tips, offers, and promotions" },
                            ].map((item) => {
                                const enabled = notifications?.[item.key] ?? false;

                                return (
                                    <div key={item.key} className="flex items-center justify-between py-2">
                                        <div>
                                            <p className="text-sm font-medium text-fg">{item.label}</p>
                                            <p className="text-xs text-muted">{item.desc}</p>
                                        </div>
                                        <button
                                            role="switch"
                                            aria-checked={enabled}
                                            aria-label={item.label}
                                            disabled={!notifications || notificationStatus.kind === "saving"}
                                            onClick={() =>
                                                notifications &&
                                                saveNotifications({ ...notifications, [item.key]: !enabled })
                                            }
                                            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${enabled ? "bg-[var(--primary)]" : "bg-[var(--card-border)]"
                                                }`}
                                        >
                                            <span
                                                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card transition-transform ${enabled ? "translate-x-5" : "translate-x-0"
                                                    }`}
                                            />
                                        </button>
                                    </div>
                                );
                            })}
                            <div className="pt-2 min-h-6">
                                {!account ? (
                                    <p className="text-xs text-muted">Loading your settings…</p>
                                ) : (
                                    <StatusMessage status={notificationStatus} savedLabel="Saved to your account" />
                                )}
                            </div>
                            <p className="text-xs text-muted">
                                Messages you ask for — support replies, team invites, account deletion — are always sent.
                            </p>
                        </div>
                    )}

                    {tab === "password" && (
                        <div className="space-y-4 max-w-md">
                            <h2 className="text-lg font-semibold text-fg mb-4">Change Password</h2>

                            {!canUsePassword ? (
                                <p className="text-sm text-muted">
                                    You signed in with a social provider, so your password is managed there rather
                                    than by PDF AI Assistant.
                                </p>
                            ) : (
                                <>
                                    <div>
                                        <label htmlFor="currentPassword" className="block text-sm font-medium text-fg mb-1.5">
                                            Current password
                                        </label>
                                        <input
                                            id="currentPassword"
                                            type="password"
                                            autoComplete="current-password"
                                            value={currentPassword}
                                            onChange={(e) => {
                                                setCurrentPassword(e.target.value);
                                                setPasswordStatus({ kind: "idle" });
                                            }}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="newPassword" className="block text-sm font-medium text-fg mb-1.5">
                                            New password
                                        </label>
                                        <input
                                            id="newPassword"
                                            type="password"
                                            autoComplete="new-password"
                                            value={newPassword}
                                            onChange={(e) => {
                                                setNewPassword(e.target.value);
                                                setPasswordStatus({ kind: "idle" });
                                            }}
                                            className={inputClass}
                                        />
                                        <p className="text-xs text-muted mt-1.5">At least 8 characters.</p>
                                    </div>
                                    <div>
                                        <label htmlFor="confirmPassword" className="block text-sm font-medium text-fg mb-1.5">
                                            Confirm new password
                                        </label>
                                        <input
                                            id="confirmPassword"
                                            type="password"
                                            autoComplete="new-password"
                                            value={confirmPassword}
                                            onChange={(e) => {
                                                setConfirmPassword(e.target.value);
                                                setPasswordStatus({ kind: "idle" });
                                            }}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleChangePassword}
                                            disabled={
                                                passwordStatus.kind === "saving" ||
                                                !currentPassword ||
                                                !newPassword ||
                                                !confirmPassword
                                            }
                                            className={buttonClass}
                                        >
                                            {passwordStatus.kind === "saving" && (
                                                <Loader2 size={15} className="animate-spin" />
                                            )}
                                            {passwordStatus.kind === "saving" ? "Updating..." : "Update Password"}
                                        </button>
                                        <StatusMessage status={passwordStatus} savedLabel="Password updated" />
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {tab === "language" && (
                        <div className="max-w-md">
                            <h2 className="text-lg font-semibold text-fg mb-4">{t("settings.language")}</h2>
                            <label className="block text-sm font-medium text-fg mb-1.5">
                                {t("settings.interfaceLanguage")}
                            </label>

                            {/* Custom Searchable Dropdown */}
                            <div className="relative" ref={langDropdownRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                                    className={`${inputClass} flex items-center text-left relative pr-12`}
                                >
                                    <span className="truncate block w-full">{selectedLanguageName}</span>
                                    {/* Icon moved a little bit toward the left side using absolute positioning (right-4 md:right-5) */}
                                    <ChevronDown size={18} className="text-muted absolute right-4 md:right-5 pointer-events-none" />
                                </button>

                                {isLangDropdownOpen && (
                                    <div className="absolute z-10 w-full mt-1.5 bg-card border border-card rounded-xl shadow-lg overflow-hidden flex flex-col max-h-[300px]">
                                        {/* Search Input inside Dropdown */}
                                        <div className="p-2 border-b border-card flex items-center gap-2">
                                            <Search size={16} className="text-muted ml-2 shrink-0" />
                                            <input
                                                type="text"
                                                placeholder={t("settings.searchLanguages")}
                                                value={langSearch}
                                                onChange={(e) => setLangSearch(e.target.value)}
                                                className="w-full bg-transparent border-none focus:outline-none text-sm text-fg py-1.5"
                                            />
                                        </div>
                                        
                                        {/* Language List */}
                                        <ul className="overflow-y-auto p-1.5 flex-1">
                                            {filteredLanguages.length > 0 ? (
                                                filteredLanguages.map((lang) => (
                                                    <li key={lang.code}>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                savePreferences({ ...prefs, language: lang.code });
                                                                setIsLangDropdownOpen(false);
                                                                setLangSearch("");
                                                            }}
                                                            className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--primary)]/10 transition-colors ${
                                                                prefs.language === lang.code ? "bg-[var(--primary)]/10 text-[var(--primary)] font-medium" : "text-fg"
                                                            }`}
                                                        >
                                                            <span>{lang.name}</span>
                                                            <span className="shrink-0 text-xs text-muted">{lang.nativeName}</span>
                                                        </button>
                                                    </li>
                                                ))
                                            ) : (
                                                <li className="px-3 py-4 text-sm text-center text-muted">No languages found.</li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-muted mt-2">
                                Saved on this device. Translations arrive with the localisation work.
                            </p>
                        </div>
                    )}

                    {tab === "billing" && <BillingTab />}
                    {tab === "team" && <TeamTab />}
                </div>
            </div>
        </div>
    );
}