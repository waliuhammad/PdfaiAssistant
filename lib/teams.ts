import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { resolvePlan, type UserProfile } from "@/lib/firebase/users";
import { planSatisfies, type PlanId } from "@/lib/plans";

/**
 * Business teams: an owner on the Business plan and up to four other people
 * who get the Business plan through them.
 *
 * `teams/{ownerUid}` — one team per owner, so "which team does this owner
 * run" never needs a query. It lists the members; each member's own user
 * document carries `teamId` pointing back. Both sides are written together in a
 * transaction, and the plan check requires both, so a half-written membership
 * grants nothing.
 *
 * Membership does not copy the plan onto the member. It is resolved at read
 * time from the owner's own profile, which means an owner whose Business plan
 * lapses, is refunded or is downgraded takes the team's plan with it at that
 * moment — no webhook has to remember to walk the member list.
 *
 * Each member keeps their own daily allowance. The seats are seats, not a pool:
 * one busy colleague cannot spend the whole team's day.
 */

/** The owner counts as one of the five. */
export const TEAM_SEATS = 5;

/** How long an invite link works for. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TeamMember {
    uid: string;
    email: string;
    joinedAt: number;
}

export interface TeamDoc {
    ownerUid: string;
    ownerEmail: string;
    members: TeamMember[];
    createdAt?: unknown;
}

export interface InviteDoc {
    teamId: string;
    email: string;
    invitedBy: string;
    createdAt: number;
    expiresAt: number;
}

export function normaliseEmail(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Invite links carry a random token; Firestore only ever holds its hash. The
 * id of the invite document is that hash, so a leaked database export cannot
 * be turned back into working links.
 */
export function newInviteToken(): { token: string; id: string } {
    const token = randomBytes(24).toString("base64url");
    return { token, id: inviteIdFor(token) };
}

export function inviteIdFor(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function teamRef(db: Firestore, ownerUid: string) {
    return db.collection("teams").doc(ownerUid);
}

/** Where someone's plan comes from, for the screens that have to say so. */
export interface EffectivePlan {
    plan: PlanId;
    source: "own" | "team";
    /** The team the account belongs to as a member, when it does. */
    teamId: string | null;
}

/**
 * The plan an account is actually entitled to: its own, or its team's if that
 * is higher.
 *
 * A team plan counts only while all three hold: the member's profile points at
 * the team, the team lists the member, and the owner is still on Business.
 */
export async function resolveEffectivePlan(
    db: Firestore,
    uid: string,
    profile: (UserProfile & { teamId?: unknown }) | null
): Promise<EffectivePlan> {
    const own = resolvePlan(profile);
    const teamId = typeof profile?.teamId === "string" && profile.teamId ? profile.teamId : null;

    // Nothing a team can add to an account that is already on the top plan,
    // and an owner's own team is not a second source.
    if (!teamId || teamId === uid || own === "business") {
        return { plan: own, source: "own", teamId };
    }

    try {
        const [teamSnap, ownerSnap] = await Promise.all([
            teamRef(db, teamId).get(),
            db.collection("users").doc(teamId).get(),
        ]);

        const team = teamSnap.data() as TeamDoc | undefined;
        const listed = team?.members?.some((m) => m.uid === uid) ?? false;
        const ownerPlan = resolvePlan((ownerSnap.data() ?? null) as UserProfile | null);

        if (listed && ownerPlan === "business" && !planSatisfies(own, "business")) {
            return { plan: "business", source: "team", teamId };
        }
    } catch (err) {
        // A failed lookup costs the member the team plan for one request,
        // which is better than failing their tool outright.
        console.error("[teams] could not resolve the team plan", err);
    }

    return { plan: own, source: "own", teamId };
}

/**
 * Removes one member, both sides at once. Used for an owner removing someone,
 * a member leaving, and account deletion.
 */
export async function removeMember(db: Firestore, teamId: string, memberUid: string): Promise<void> {
    const ref = teamRef(db, teamId);
    const userRef = db.collection("users").doc(memberUid);

    await db.runTransaction(async (tx) => {
        const [teamSnap, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
        const team = teamSnap.data() as TeamDoc | undefined;

        if (team) {
            tx.update(ref, {
                members: team.members.filter((m) => m.uid !== memberUid),
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        // Only cleared if it still points here; the person may already have
        // moved to another team.
        if (userSnap.exists && userSnap.data()?.teamId === teamId) {
            tx.update(userRef, { teamId: FieldValue.delete() });
        }
    });
}

/**
 * Ends a team: every member is released and the pending invites are dropped.
 * For an owner deleting their account.
 */
export async function dissolveTeam(db: Firestore, ownerUid: string): Promise<void> {
    const snap = await teamRef(db, ownerUid).get();
    const team = snap.data() as TeamDoc | undefined;

    for (const member of team?.members ?? []) {
        await removeMember(db, ownerUid, member.uid);
    }

    const invites = await db.collection("teamInvites").where("teamId", "==", ownerUid).get();
    await Promise.all(invites.docs.map((d) => d.ref.delete()));

    if (snap.exists) await snap.ref.delete();
}
