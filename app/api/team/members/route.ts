import { NextRequest, NextResponse } from "next/server";
import { removeMember, teamRef, type TeamDoc } from "@/lib/teams";
import { fail, teamCaller } from "../_shared";

export const runtime = "nodejs";

/**
 * Takes someone off a team.
 *
 * `{ uid }` naming a member: the owner removing them. No uid, or the caller's
 * own: the caller leaving the team they belong to. Nobody else can remove
 * anybody.
 */
export async function DELETE(req: NextRequest) {
    const caller = await teamCaller(req);
    if (caller instanceof NextResponse) return caller;
    const { db, uid, profile } = caller;

    const body = await req.json().catch(() => null);
    const target = typeof body?.uid === "string" && body.uid ? body.uid : uid;

    try {
        if (target === uid) {
            const teamId = typeof profile?.teamId === "string" ? profile.teamId : null;
            if (!teamId || teamId === uid) return fail("You're not a member of a team.", 400);
            await removeMember(db, teamId, uid);
            return NextResponse.json({ success: true });
        }

        const team = (await teamRef(db, uid).get()).data() as TeamDoc | undefined;
        if (!team?.members.some((m) => m.uid === target)) {
            return fail("That person isn't on your team.", 404);
        }
        await removeMember(db, uid, target);
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("[team] could not remove a member", err);
        return fail("Could not update the team. Please try again.", 500);
    }
}
