"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { confirmIdentity, hasPasswordProvider, logout } from "@/lib/firebase/auth";

/**
 * The danger zone at the bottom of the profile tab.
 *
 * Two confirmations: typing DELETE, and signing in again. The server refuses
 * without a sign-in from the last few minutes, so this asks for it up front
 * instead of failing after the person has already decided.
 */
export function DeleteAccount() {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const needsPassword = hasPasswordProvider(user);
    const ready = typed === "DELETE" && (!needsPassword || password.length > 0);

    const handleDelete = async () => {
        if (!ready) return;
        setBusy(true);
        setError(null);

        try {
            let idToken: string;
            try {
                idToken = await confirmIdentity(needsPassword ? password : undefined);
            } catch (err) {
                const code = (err as { code?: string })?.code;
                setError(
                    code === "auth/wrong-password" || code === "auth/invalid-credential"
                        ? "That password is incorrect."
                        : code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"
                            ? "Sign-in was cancelled, so nothing was deleted."
                            : code === "auth/too-many-requests"
                                ? "Too many attempts. Try again later."
                                : "We couldn't confirm it's you. Please try again."
                );
                setBusy(false);
                return;
            }

            const res = await fetch("/api/account", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm: "DELETE", idToken }),
            });
            const data = await res.json().catch(() => null);

            if (!res.ok || !data?.success) {
                setError(data?.message ?? "We couldn't delete your account. Please try again.");
                setBusy(false);
                return;
            }

            // The account is gone; clearing the browser's sign-in is all that is left.
            await logout().catch(() => { });
            window.location.assign("/");
        } catch {
            setError("Could not reach the server. Please try again.");
            setBusy(false);
        }
    };

    return (
        <div className="mt-10 max-w-md rounded-xl border border-red-200 p-5 dark:border-red-500/30">
            <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Delete account</h3>
            <p className="mt-1 text-sm text-muted">
                Permanently deletes your account, your settings, usage history and rating, cancels any
                subscription and removes you from any team. This can&apos;t be undone.
            </p>

            {!open ? (
                <button
                    onClick={() => setOpen(true)}
                    className="mt-4 rounded-full border border-red-300 px-5 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                    Delete my account
                </button>
            ) : (
                <div className="mt-4 space-y-3">
                    <div>
                        <label htmlFor="delete-confirm" className="mb-1.5 block text-sm font-medium text-fg">
                            Type <span className="font-mono">DELETE</span> to confirm
                        </label>
                        <input
                            id="delete-confirm"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            autoComplete="off"
                            className="w-full rounded-xl border border-card bg-card px-4 py-2.5 text-fg focus:border-red-400 focus:outline-none"
                        />
                    </div>

                    {needsPassword ? (
                        <div>
                            <label htmlFor="delete-password" className="mb-1.5 block text-sm font-medium text-fg">
                                Your password
                            </label>
                            <input
                                id="delete-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                                className="w-full rounded-xl border border-card bg-card px-4 py-2.5 text-fg focus:border-red-400 focus:outline-none"
                            />
                        </div>
                    ) : (
                        <p className="text-xs text-muted">
                            You&apos;ll be asked to sign in again to confirm.
                        </p>
                    )}

                    {error && (
                        <p className="flex items-start gap-1.5 text-sm text-red-600" role="alert">
                            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={handleDelete}
                            disabled={!ready || busy}
                            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {busy && <Loader2 size={15} className="animate-spin" />}
                            {busy ? "Deleting…" : "Permanently delete"}
                        </button>
                        <button
                            onClick={() => {
                                setOpen(false);
                                setTyped("");
                                setPassword("");
                                setError(null);
                            }}
                            disabled={busy}
                            className="text-sm text-muted hover:text-fg"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
