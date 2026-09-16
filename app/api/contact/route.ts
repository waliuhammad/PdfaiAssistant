import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp, getAdminAuth, isAdminConfigured, adminConfigProblem } from "@/lib/firebase/admin";
import { getRequestUid } from "@/lib/server-auth";
import { rateLimit } from "@/lib/rate-limit";
import { resolveEffectivePlan } from "@/lib/teams";
import type { UserProfile } from "@/lib/firebase/users";
import type { PlanId } from "@/lib/plans";
import { sendEmail, supportInbox } from "@/lib/email";

/**
 * Receives contact-form messages and stores them in the `contactMessages`
 * collection in Firestore, where they can be read in the Firebase Console.
 *
 * Stored first and emailed second: the stored copy needs no extra service, so
 * nothing is lost if mail is down or misconfigured. When SUPPORT_EMAIL is set
 * the message is also forwarded there, with Reply-To set to the sender.
 *
 * Priority support: a message from a signed-in Pro or Business account (their
 * own plan or a team's) is marked `priority` and its forwarded subject says so,
 * so it can be picked out and answered first.
 *
 * The admin SDK writes with full privileges, so client security rules don't
 * need to open this collection up — visitors can submit without being able
 * to read anyone else's messages.
 */

const MAX_LENGTHS = {
    name: 200,
    email: 320,
    subject: 300,
    message: 5000,
} as const;

export async function POST(req: NextRequest) {
    const limited = rateLimit(req, { name: "contact", limit: 5, windowMs: 10 * 60 * 1000 });
    if (limited) return limited;

    try {
        const body = await req.json().catch(() => null);

        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const email = typeof body?.email === "string" ? body.email.trim() : "";
        const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
        const message = typeof body?.message === "string" ? body.message.trim() : "";

        if (!name || !message || !/^\S+@\S+\.\S+$/.test(email)) {
            return NextResponse.json(
                { success: false, message: "Name, a valid email, and a message are required." },
                { status: 400 }
            );
        }

        if (
            name.length > MAX_LENGTHS.name ||
            email.length > MAX_LENGTHS.email ||
            subject.length > MAX_LENGTHS.subject ||
            message.length > MAX_LENGTHS.message
        ) {
            return NextResponse.json(
                { success: false, message: "One of the fields is too long." },
                { status: 400 }
            );
        }

        if (!isAdminConfigured()) {
            // Configuration problems are a server-side concern; log the detail,
            // tell the visitor something they can act on.
            console.error("Contact form unavailable:", adminConfigProblem());
            return NextResponse.json(
                { success: false, message: "Messaging is temporarily unavailable. Please email us directly." },
                { status: 503 }
            );
        }

        const db = getFirestore(getAdminApp());

        // Signed-out visitors can write too; the account only adds priority.
        const uid = await getRequestUid(req);
        let plan: PlanId = "free";
        let accountEmail: string | null = null;
        if (uid) {
            const [profileSnap, user] = await Promise.all([
                db.collection("users").doc(uid).get(),
                getAdminAuth().getUser(uid).catch(() => null),
            ]);
            const profile = (profileSnap.data() ?? null) as UserProfile | null;
            plan = (await resolveEffectivePlan(db, uid, profile)).plan;
            accountEmail = user?.email ?? null;
        }
        const priority = plan !== "free";

        const doc = await db.collection("contactMessages").add({
            name,
            email,
            subject: subject || null,
            message,
            uid: uid ?? null,
            plan,
            priority,
            createdAt: new Date().toISOString(),
            read: false,
        });

        const inbox = supportInbox();
        if (inbox) {
            await sendEmail({
                to: inbox,
                subject: `${priority ? `[PRIORITY · ${plan}] ` : ""}${subject || "Contact form message"}`,
                replyTo: email,
                text: [
                    `From: ${name} <${email}>`,
                    `Account: ${uid ? `${uid} (${plan} plan)` : "not signed in"}`,
                    `Reference: ${doc.id}`,
                    message,
                ].join("\n\n"),
            });
        }

        // The acknowledgement only goes to the signed-in account's own
        // address. Emailing whatever address the form was given would let
        // anyone use this endpoint to send mail to strangers.
        if (accountEmail) {
            await sendEmail({
                to: accountEmail,
                subject: "We've received your message",
                text: [
                    `Hi ${name},`,
                    "Thanks for getting in touch — your message has reached the PDF AI Assistant team.",
                    priority
                        ? `As a ${plan === "business" ? "Business" : "Pro"} customer, your message is in our priority queue.`
                        : "We'll get back to you as soon as we can.",
                    `Reference: ${doc.id}`,
                ].join("\n\n"),
            });
        }

        return NextResponse.json({ success: true, priority });
    } catch (err) {
        console.error("Contact form error:", err);
        return NextResponse.json(
            { success: false, message: "Could not send your message. Please try again." },
            { status: 500 }
        );
    }
}