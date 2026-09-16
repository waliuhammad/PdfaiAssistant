import { NextRequest, NextResponse } from "next/server";
import { teamRef, TEAM_SEATS, type InviteDoc, type TeamDoc } from "@/lib/teams";
import { fail, ownsBusinessPlan, teamCaller } from "./_shared";

/**
 * The caller's team, from whichever side they are on.
 *
 * - `owner`: members and pending invites, and whether the Business plan that
 *   powers them is still active.
 * - `member`: who runs the team, so they know where their plan comes from.
 * - `none`: whether they could start one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const caller = await teamCaller(req);
    if (caller instanceof NextResponse) return caller;
    const { db, uid, profile } = caller;

    try {
        const own = await teamRef(db, uid).get();
        const canOwn = ownsBusinessPlan(caller);

        if (own.exists || canOwn) {
            const team = own.data() as TeamDoc | undefined;
            const invites = own.exists
                ? await db.collection("teamInvites").where("teamId", "==", uid).get()
                : null;
            const now = Date.now();

            return NextResponse.json({
                success: true,
                role: "owner",
                seats: TEAM_SEATS,
                active: canOwn,
                members: (team?.members ?? []).map((m) => ({
                    uid: m.uid,
                    email: m.email,
                    joinedAt: m.joinedAt,
                })),
                invites: (invites?.docs ?? [])
                    .map((d) => ({ id: d.id, ...(d.data() as InviteDoc) }))
                    .filter((i) => i.expiresAt > now)
                    .map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt })),
            });
        }

        const teamId = typeof profile?.teamId === "string" ? profile.teamId : null;
        if (teamId) {
            const team = (await teamRef(db, teamId).get()).data() as TeamDoc | undefined;
            if (team?.members.some((m) => m.uid === uid)) {
                return NextResponse.json({
                    success: true,
                    role: "member",
                    ownerEmail: team.ownerEmail,
                });
            }
        }

        return NextResponse.json({ success: true, role: "none" });
    } catch (err) {
        console.error("[team] could not read the team", err);
        return fail("Could not load your team. Please try again.", 500);
    }
}
