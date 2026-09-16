"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Copy, Loader2, UserMinus, X } from "lucide-react";

type TeamView =
    | {
        role: "owner";
        seats: number;
        active: boolean;
        members: { uid: string; email: string; joinedAt: number }[];
        invites: { id: string; email: string; expiresAt: number }[];
    }
    | { role: "member"; ownerEmail: string }
    | { role: "none" };

/**
 * Team members for the Business plan: invite up to four people, see who has
 * joined, remove them. A member sees whose team they are on and can leave.
 */
export function TeamTab() {
    const [team, setTeam] = useState<TeamView | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [version, setVersion] = useState(0);

    const [email, setEmail] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
    const [copied, setCopied] = useState(false);

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    useEffect(() => {
        const controller = new AbortController();
        fetch("/api/team", { cache: "no-store", signal: controller.signal })
            .then(async (res) => {
                const data = await res.json().catch(() => null);
                if (res.ok && data?.success) {
                    setTeam(data as TeamView);
                    setLoadError(null);
                } else {
                    setLoadError(data?.message ?? "Could not load your team.");
                }
            })
            .catch((err) => {
                if ((err as Error)?.name !== "AbortError") setLoadError("Could not reach the server.");
            });
        return () => controller.abort();
    }, [version]);

    const call = async (key: string, url: string, method: string, body: unknown) => {
        setBusy(key);
        setError(null);
        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                setError(data?.message ?? "Something went wrong. Please try again.");
                return null;
            }
            reload();
            return data;
        } catch {
            setError("Could not reach the server. Please try again.");
            return null;
        } finally {
            setBusy(null);
        }
    };

    const invite = async (e: React.FormEvent) => {
        e.preventDefault();
        setSent(null);
        setCopied(false);
        const data = await call("invite", "/api/team/invites", "POST", { email });
        if (data) {
            setSent({ email: data.email, link: data.link, emailed: data.emailed });
            setEmail("");
        }
    };

    const copyLink = async () => {
        if (!sent) return;
        try {
            await navigator.clipboard.writeText(sent.link);
            setCopied(true);
        } catch {
            // The link is on screen to copy by hand.
        }
    };

    const heading = <h2 className="text-lg font-semibold text-fg mb-4">Team</h2>;

    if (loadError) {
        return (
            <div className="max-w-lg">
                {heading}
                <p className="flex items-start gap-1.5 text-sm text-red-600">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" /> {loadError}
                </p>
            </div>
        );
    }

    if (!team) {
        return (
            <div className="max-w-lg flex items-center gap-2 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" /> Loading your team…
            </div>
        );
    }

    const errorLine = error && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-red-600" role="alert">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
    );

    if (team.role === "member") {
        return (
            <div className="max-w-lg">
                {heading}
                <p className="text-sm text-fg">
                    You&apos;re on <span className="font-medium">{team.ownerEmail}</span>&apos;s team, which gives you
                    the Business plan.
                </p>
                <button
                    onClick={() => call("leave", "/api/team/members", "DELETE", {})}
                    disabled={busy !== null}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-card px-5 py-2 text-sm font-medium text-fg hover:border-red-300 hover:text-red-600 disabled:opacity-60"
                >
                    {busy === "leave" && <Loader2 size={15} className="animate-spin" />}
                    Leave team
                </button>
                {errorLine}
            </div>
        );
    }

    if (team.role === "none") {
        return (
            <div className="max-w-lg">
                {heading}
                <p className="text-sm text-muted">
                    The Business plan includes up to 5 team members, each with their own Business allowance.
                </p>
                <Link
                    href="/pricing"
                    className="mt-4 inline-block rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--primary-hover)]"
                >
                    See Business plan
                </Link>
            </div>
        );
    }

    const used = 1 + team.members.length + team.invites.length;
    const full = used >= team.seats;

    return (
        <div className="max-w-lg">
            {heading}

            {!team.active && (
                <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                    Your Business plan isn&apos;t active, so your team members are back on their own plans.
                    Renew Business to restore their access.
                </p>
            )}

            <p className="text-sm text-muted">
                {used} of {team.seats} seats used (including you).
            </p>

            <ul className="mt-4 divide-y divide-[var(--card-border)] rounded-xl border border-card">
                <li className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="text-fg">You</span>
                    <span className="text-xs text-muted">Owner</span>
                </li>
                {team.members.map((m) => (
                    <li key={m.uid} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="min-w-0 break-all text-fg">{m.email}</span>
                        <button
                            onClick={() => call(`remove:${m.uid}`, "/api/team/members", "DELETE", { uid: m.uid })}
                            disabled={busy !== null}
                            aria-label={`Remove ${m.email}`}
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted hover:text-red-600 disabled:opacity-60"
                        >
                            {busy === `remove:${m.uid}` ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <UserMinus size={14} />
                            )}
                            Remove
                        </button>
                    </li>
                ))}
                {team.invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="min-w-0 break-all text-muted">
                            {i.email} <span className="text-xs">· invited</span>
                        </span>
                        <button
                            onClick={() => call(`cancel:${i.id}`, "/api/team/invites", "DELETE", { id: i.id })}
                            disabled={busy !== null}
                            aria-label={`Cancel invite for ${i.email}`}
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted hover:text-red-600 disabled:opacity-60"
                        >
                            {busy === `cancel:${i.id}` ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                            Cancel
                        </button>
                    </li>
                ))}
            </ul>

            {team.active && (
                <form onSubmit={invite} className="mt-5">
                    <label htmlFor="invite-email" className="mb-1.5 block text-sm font-medium text-fg">
                        Invite by email
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                            id="invite-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={full}
                            placeholder={full ? "Your team is full" : "colleague@company.com"}
                            className="min-w-0 flex-1 rounded-xl border border-card bg-card px-4 py-2.5 text-fg focus:border-[var(--primary)] focus:outline-none disabled:opacity-60"
                        />
                        <button
                            type="submit"
                            disabled={full || busy !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {busy === "invite" && <Loader2 size={15} className="animate-spin" />}
                            Send invite
                        </button>
                    </div>
                </form>
            )}

            {errorLine}

            {sent && (
                <div className="mt-4 rounded-xl border border-card p-4 text-sm">
                    <p className="flex items-center gap-1.5 text-green-600">
                        <Check size={15} />
                        {sent.emailed ? `Invite emailed to ${sent.email}.` : `Invite created for ${sent.email}.`}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                        {sent.emailed
                            ? "You can also share this link with them directly:"
                            : "Send them this link — it only works for that email address and expires in 7 days:"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--background-secondary)] px-2 py-1.5 text-xs">
                            {sent.link}
                        </code>
                        <button
                            type="button"
                            onClick={copyLink}
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted hover:text-fg"
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
