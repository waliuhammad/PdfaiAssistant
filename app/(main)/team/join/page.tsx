"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const subscribeToNothing = () => () => { };
const readToken = () => new URLSearchParams(window.location.search).get("token") ?? "";

/**
 * Where an invite link lands.
 *
 * Deliberately outside the protected area: the person invited may not have an
 * account yet, and this page is where they are told to make one with the
 * invited address. Accepting still needs a signed-in session, checked by the
 * API.
 */
export default function JoinTeamPage() {
    const router = useRouter();
    const { user, loading } = useAuth();
    const token = useSyncExternalStore(subscribeToNothing, readToken, () => "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const here = `/team/join?token=${encodeURIComponent(token)}`;

    const accept = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/team/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                router.push("/settings?tab=team");
                return;
            }
            setError(data?.message ?? "Could not join the team. Please try again.");
        } catch {
            setError("Could not reach the server. Please try again.");
        }
        setBusy(false);
    };

    return (
        <main className="min-h-[70vh] flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="w-full max-w-md rounded-2xl border border-card bg-card p-6 sm:p-8 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)]/10">
                    <Users size={22} className="text-[var(--primary)]" />
                </div>
                <h1 className="text-xl font-bold text-fg">Join a team</h1>
                <p className="mt-2 text-sm text-muted">
                    You&apos;ve been invited to a PDF AI Assistant Business team. Joining gives you the
                    Business plan while you&apos;re a member.
                </p>

                {!token ? (
                    <p className="mt-6 text-sm text-red-600">This invite link is incomplete. Open it from the email again.</p>
                ) : loading ? (
                    <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
                        <Loader2 size={15} className="animate-spin" /> Checking your sign-in…
                    </p>
                ) : !user ? (
                    <div className="mt-6 space-y-3">
                        <p className="text-sm text-fg">Sign in with the email address the invite was sent to.</p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                            <Link
                                href={`/login?next=${encodeURIComponent(here)}`}
                                className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--primary-hover)]"
                            >
                                Log in
                            </Link>
                            <Link
                                href={`/register?next=${encodeURIComponent(here)}`}
                                className="rounded-full border border-card px-5 py-2.5 text-sm font-medium text-fg hover:border-[var(--primary)]"
                            >
                                Create an account
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6">
                        <p className="text-sm text-muted">
                            Signed in as <span className="break-all text-fg">{user.email}</span>
                        </p>
                        <button
                            onClick={accept}
                            disabled={busy}
                            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--primary-hover)] disabled:opacity-60"
                        >
                            {busy && <Loader2 size={15} className="animate-spin" />}
                            Accept invite
                        </button>
                    </div>
                )}

                {error && (
                    <p className="mt-4 flex items-start justify-center gap-1.5 text-sm text-red-600" role="alert">
                        <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
                    </p>
                )}
            </div>
        </main>
    );
}
