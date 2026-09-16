import "server-only";
import type { NextRequest } from "next/server";
import { isAdminConfigured, SESSION_COOKIE } from "@/lib/firebase/admin";
import { verifySession } from "@/lib/session-verify";

/**
 * Who is making this request?
 *
 * Reads the same session cookie proxy.ts uses to guard pages and verifies
 * it with the Admin SDK, so API routes can identify the user without
 * trusting anything the browser claims about itself. Returns null for
 * signed-out visitors and for expired or forged cookies — the caller
 * decides whether that means "refuse" (AI tools) or "continue" (open
 * tools).
 */
/**
 * The same answer as getRequestUid, for server components, which are handed
 * no request object. Lets a page render the user's real numbers into the HTML
 * instead of shipping a placeholder and asking for them after mount.
 */
export async function getSessionUid(): Promise<string | null> {
    if (!isAdminConfigured()) return null;

    const { cookies } = await import("next/headers");
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!session) return null;

    return verifySession(session);
}

export async function getRequestUid(req: NextRequest): Promise<string | null> {
    if (!isAdminConfigured()) return null;

    const session = req.cookies.get(SESSION_COOKIE)?.value;
    if (!session) return null;

    // Expired, revoked or invalid — null, treated exactly like signed out.
    return verifySession(session);
}