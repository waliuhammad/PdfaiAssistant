import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import {
    INVITE_TTL_MS,
    newInviteToken,
    normaliseEmail,
    teamRef,
    TEAM_SEATS,
    type InviteDoc,
    type TeamDoc,
} from "@/lib/teams";
import { fail, ownsBusinessPlan, teamCaller } from "../_shared";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invites someone to the caller's team.
 *
 * The link is returned to the owner as well as emailed. It is theirs to share
 * if mail is not set up or lands in spam; the token only works for the invited
 * address, so a forwarded link is no use to anyone else.
 */
export async function POST(req: NextRequest) {
    const limited = rateLimit(req, { name: "team-invite", limit: 20, windowMs: 60 * 60 * 1000 });
    if (limited) return limited;

    const caller = await teamCaller(req);
    if (caller instanceof NextResponse) return caller;
    const { db, uid, email: ownerEmail } = caller;

    if (!ownsBusinessPlan(caller)) {
        return fail("Teams are part of the Business plan. Upgrade to invite people.", 403);
    }

    const body = await req.json().catch(() => null);
    const raw = typeof body?.email === "string" ? body.email : "";
    const email = normaliseEmail(raw);
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
        return fail("Enter a valid email address.", 400);
    }
    if (email === ownerEmail) {
        return fail("You're already on your team.", 400);
    }

    const { token, id } = newInviteToken();
    const now = Date.now();
    const ref = teamRef(db, uid);

    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const team = snap.data() as TeamDoc | undefined;
            const invites = await tx.get(db.collection("teamInvites").where("teamId", "==", uid));
            const pending = invites.docs
                .map((d) => d.data() as InviteDoc)
                .filter((i) => i.expiresAt > now);

            if (team?.members.some((m) => m.email === email)) {
                throw new InviteError("That person is already on your team.");
            }
            if (pending.some((i) => i.email === email)) {
                throw new InviteError("That person already has an invite. Cancel it to send a new one.");
            }

            // The owner, the members and the outstanding invites all hold a seat.
            const taken = 1 + (team?.members.length ?? 0) + pending.length;
            if (taken >= TEAM_SEATS) {
                throw new InviteError(`Your team is full — the Business plan includes ${TEAM_SEATS} people.`);
            }

            if (!snap.exists) {
                tx.set(ref, {
                    ownerUid: uid,
                    ownerEmail: ownerEmail ?? "",
                    members: [],
                    createdAt: FieldValue.serverTimestamp(),
                });
            }

            // Expired invites are cleared while we are here.
            for (const d of invites.docs) {
                if ((d.data() as InviteDoc).expiresAt <= now) tx.delete(d.ref);
            }

            const invite: InviteDoc = {
                teamId: uid,
                email,
                invitedBy: uid,
                createdAt: now,
                expiresAt: now + INVITE_TTL_MS,
            };
            tx.create(db.collection("teamInvites").doc(id), invite);
        });
    } catch (err) {
        if (err instanceof InviteError) return fail(err.message, 409);
        console.error("[team] could not create an invite", err);
        return fail("Could not send the invite. Please try again.", 500);
    }

    const link = `${getSiteUrl()}/team/join?token=${token}`;
    const emailed = await sendEmail({
        to: email,
        subject: "You've been invited to a PDF AI Assistant team",
        text: [
            `${ownerEmail ?? "A PDF AI Assistant Business user"} has invited you to join their team on PDF AI Assistant.`,
            "Joining gives you the Business plan's tools and daily allowances while you're on the team.",
            `Accept the invite (sign in or create an account with this email address, ${email}):`,
            link,
            "The invite expires in 7 days. If you weren't expecting it, you can ignore this email.",
        ].join("\n\n"),
        ...(ownerEmail ? { replyTo: ownerEmail } : {}),
    });

    return NextResponse.json({ success: true, id, email, link, emailed });
}

/** Cancels an invite that has not been accepted. */
export async function DELETE(req: NextRequest) {
    const caller = await teamCaller(req);
    if (caller instanceof NextResponse) return caller;
    const { db, uid } = caller;

    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!/^[a-f0-9]{64}$/.test(id)) return fail("Unknown invite.", 400);

    try {
        const ref = db.collection("teamInvites").doc(id);
        const snap = await ref.get();
        // Someone else's invite is reported as missing, not as forbidden.
        if (!snap.exists || (snap.data() as InviteDoc).teamId !== uid) {
            return fail("That invite no longer exists.", 404);
        }
        await ref.delete();
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("[team] could not cancel an invite", err);
        return fail("Could not cancel the invite. Please try again.", 500);
    }
}

class InviteError extends Error { }
