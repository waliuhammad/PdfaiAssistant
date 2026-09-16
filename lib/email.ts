import "server-only";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp, isAdminConfigured } from "@/lib/firebase/admin";

/**
 * Outgoing email, through Resend's HTTP API.
 *
 * A plain fetch rather than an SDK: it is one POST, and a dependency for that
 * is one more thing to keep patched. Resend because it needs nothing but an API
 * key and a verified sending domain — no SMTP credentials living on Railway.
 *
 * Inert until configured. Without RESEND_API_KEY and EMAIL_FROM every send is a
 * logged no-op that reports `false`, so callers can say "we could not email
 * this" instead of pretending, and nothing in the product breaks on a deploy
 * that has not set mail up yet.
 */

const RESEND_API = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

/** Where support requests are delivered. Unset means they are only stored. */
export function supportInbox(): string | null {
    return process.env.SUPPORT_EMAIL?.trim() || null;
}

export interface Email {
    to: string;
    subject: string;
    /** Plain text is the source of truth; the HTML is generated from it. */
    text: string;
    replyTo?: string;
}

let warnedUnconfigured = false;

export async function sendEmail(email: Email): Promise<boolean> {
    if (!isEmailConfigured()) {
        if (!warnedUnconfigured) {
            console.warn("[email] RESEND_API_KEY / EMAIL_FROM not set — emails are not being sent");
            warnedUnconfigured = true;
        }
        return false;
    }

    try {
        const res = await fetch(RESEND_API, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: process.env.EMAIL_FROM!.trim(),
                to: [email.to],
                subject: email.subject,
                text: email.text,
                html: toHtml(email.text),
                ...(email.replyTo ? { reply_to: email.replyTo } : {}),
            }),
            cache: "no-store",
        });

        if (!res.ok) {
            // The recipient is left out of the log on purpose; the subject is
            // enough to find which send failed.
            const detail = await res.text().catch(() => "");
            console.error(`[email] "${email.subject}" was refused: ${res.status} ${detail.slice(0, 200)}`);
            return false;
        }
        return true;
    } catch (err) {
        console.error(`[email] "${email.subject}" could not be sent`, err);
        return false;
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Paragraphs and links, nothing more — these are notices, not newsletters. */
function toHtml(text: string): string {
    const paragraphs = text
        .split(/\n{2,}/)
        .map((block) =>
            escapeHtml(block)
                .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
                .replace(/\n/g, "<br>")
        )
        .map((block) => `<p style="margin:0 0 16px">${block}</p>`)
        .join("");

    return (
        `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;` +
        `line-height:1.55;color:#1f2937;max-width:560px">${paragraphs}</div>`
    );
}

/**
 * What an account has agreed to receive.
 *
 * - `account`: billing and account notices (a failing card, a team invite
 *   accepted). The "Email notifications" switch.
 * - `product` / `marketing`: the other two switches; nothing sends these yet,
 *   but the setting is honoured the moment something does.
 *
 * Mail that answers something the person just did — a support
 * acknowledgement, the confirmation that their account was deleted, an invite
 * sent to them by someone else — is not a notification and ignores these.
 */
export type NotificationKind = "account" | "product" | "marketing";

export interface NotificationPrefs {
    email: boolean;
    product: boolean;
    marketing: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
    email: true,
    product: true,
    marketing: false,
};

export function readNotificationPrefs(value: unknown): NotificationPrefs {
    const stored = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const pick = (key: keyof NotificationPrefs) =>
        typeof stored[key] === "boolean" ? (stored[key] as boolean) : DEFAULT_NOTIFICATIONS[key];
    return { email: pick("email"), product: pick("product"), marketing: pick("marketing") };
}

const KIND_SWITCH: Record<NotificationKind, keyof NotificationPrefs> = {
    account: "email",
    product: "product",
    marketing: "marketing",
};

/**
 * Sends a notification to an account, if the account wants it.
 *
 * The address is read from the profile rather than passed in, so a
 * notification can only ever go to the person it is about.
 */
export async function notifyUser(
    uid: string,
    kind: NotificationKind,
    message: Omit<Email, "to">
): Promise<boolean> {
    if (!isAdminConfigured()) return false;

    const snap = await getFirestore(getAdminApp()).collection("users").doc(uid).get();
    const data = snap.data();
    const to = typeof data?.email === "string" ? data.email : null;
    if (!to) return false;

    const prefs = readNotificationPrefs(data?.preferences?.notifications);
    if (!prefs[KIND_SWITCH[kind]]) return false;

    return sendEmail({ ...message, to });
}
