import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAdminApp, getAdminAuth, isAdminConfigured } from "@/lib/firebase/admin";
import { getRequestUid } from "@/lib/server-auth";
import type { UserProfile } from "@/lib/firebase/users";
import { resolvePlan } from "@/lib/firebase/users";
import { normaliseEmail } from "@/lib/teams";

/**
 * What every team route needs before it can do anything: admin access, a
 * verified session, and the caller's email as Firebase Auth holds it — never
 * as the request or the profile document claims it.
 */
export interface TeamCaller {
    db: Firestore;
    uid: string;
    email: string | null;
    profile: (UserProfile & Record<string, unknown>) | null;
}

export async function teamCaller(req: NextRequest): Promise<TeamCaller | NextResponse> {
    if (!isAdminConfigured()) return fail("Teams are not available right now.", 503);

    const uid = await getRequestUid(req);
    if (!uid) return fail("Sign in to continue.", 401);

    const db = getFirestore(getAdminApp());
    try {
        const [user, snap] = await Promise.all([
            getAdminAuth().getUser(uid),
            db.collection("users").doc(uid).get(),
        ]);

        return {
            db,
            uid,
            email: user.email ? normaliseEmail(user.email) : null,
            profile: (snap.data() ?? null) as TeamCaller["profile"],
        };
    } catch (err) {
        console.error("[team] could not load the caller", err);
        return fail("Could not load your account. Please try again.", 500);
    }
}

/** Only an account paying for Business itself can run a team. */
export function ownsBusinessPlan(caller: TeamCaller): boolean {
    return resolvePlan(caller.profile) === "business";
}

export function fail(message: string, status: number): NextResponse {
    return NextResponse.json({ success: false, message }, { status });
}
