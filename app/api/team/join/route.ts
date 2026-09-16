import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { notifyUser } from "@/lib/email";
import { resolvePlan, type UserProfile } from "@/lib/firebase/users";
import { rateLimit } from "@/lib/rate-limit";
import { inviteIdFor, teamRef, TEAM_SEATS, type InviteDoc, type TeamDoc } from "@/lib/teams";
import { fail, teamCaller } from "../_shared";

export const runtime = "nodejs";

/**
 * Accepts an invite.
 *
 * The token proves the link was received; the signed-in account's email has
 * to be the one invited as well, so a forwarded link cannot put a stranger on
 * the team. Everything — the seat count, the owner still being on Business,
 * the member not already being elsewhere — is checked inside the transaction
 * that writes the membership.
 */
export async function POST(req: NextRequest) {
    const limited = rateLimit(req, { name: "team-join", limit: 20, windowMs: 10 * 60 * 1000 });
    if (limited) return limited;

    const caller = await teamCaller(req);
    if (caller instanceof NextResponse) return caller;
    const { db, uid, email } = caller;

    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail("This invite link isn't valid.", 400);

    const inviteRef = db.collection("teamInvites").doc(inviteIdFor(token));
    const userRef = db.collection("users").doc(uid);

    let ownerUid: string;
    try {
        ownerUid = await db.runTransaction(async (tx) => {
            const inviteSnap = await tx.get(inviteRef);
            const invite = inviteSnap.data() as InviteDoc | undefined;
            if (!invite || invite.expiresAt <= Date.now()) {
                throw new JoinError("This invite has expired or was cancelled. Ask for a new one.", 410);
            }
            if (!email || invite.email !== email) {
                throw new JoinError(
                    `This invite was sent to ${invite.email}. Sign in with that address to accept it.`,
                    403
                );
            }

            const ref = teamRef(db, invite.teamId);
            const ownerRef = db.collection("users").doc(invite.teamId);
            const ownTeamRef = teamRef(db, uid);
            const [teamSnap, ownerSnap, userSnap, ownTeamSnap] = await Promise.all([
                tx.get(ref),
                tx.get(ownerRef),
                tx.get(userRef),
                tx.get(ownTeamRef),
            ]);

            const team = teamSnap.data() as TeamDoc | undefined;
            if (!team || invite.teamId === uid) throw new JoinError("This invite is no longer valid.", 410);
            if (resolvePlan((ownerSnap.data() ?? null) as UserProfile | null) !== "business") {
                throw new JoinError("This team's Business plan isn't active, so it can't take new members.", 409);
            }
            if (!userSnap.exists) throw new JoinError("Finish setting up your account, then try again.", 409);

            const current = userSnap.data()?.teamId;
            if (typeof current === "string" && current && current !== invite.teamId) {
                throw new JoinError("You're already on another team. Leave it first, then accept this invite.", 409);
            }
            const ownTeam = ownTeamSnap.data() as TeamDoc | undefined;
            if (ownTeam && ownTeam.members.length > 0) {
                throw new JoinError("You run a team of your own, so you can't join another.", 409);
            }

            const already = team.members.some((m) => m.uid === uid);
            if (!already && 1 + team.members.length >= TEAM_SEATS) {
                throw new JoinError("This team is full.", 409);
            }

            if (!already) {
                tx.update(ref, {
                    members: [...team.members, { uid, email, joinedAt: Date.now() }],
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            tx.update(userRef, { teamId: invite.teamId });
            tx.delete(inviteRef);

            return invite.teamId;
        });
    } catch (err) {
        if (err instanceof JoinError) return fail(err.message, err.status);
        console.error("[team] could not accept an invite", err);
        return fail("Could not join the team. Please try again.", 500);
    }

    await notifyUser(ownerUid, "account", {
        subject: `${email} joined your PDF AI Assistant team`,
        text: `${email} accepted your invite and now has the Business plan through your team.`,
    }).catch(() => false);

    return NextResponse.json({ success: true });
}

class JoinError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}
