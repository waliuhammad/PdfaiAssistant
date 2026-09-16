import { createHash } from "node:crypto";
import { getAdminAuth } from "@/lib/firebase/admin";

/**
 * Verifies a session cookie, remembering the answer for a minute.
 *
 * `checkRevoked` makes a call to Google's Auth API, and a single dashboard load
 * was making several: the proxy, the protected layout, then /api/usage and
 * /api/account from the page. Each one added a round trip to the request.
 * A cookie verified in the last minute is taken as still valid, which means a
 * revoked session keeps working for at most that minute. The signature and
 * expiry are still checked, locally, on every call.
 *
 * Keyed by a hash so the cookies themselves are not held in memory.
 */

const TTL_MS = 60_000;
const verified = new Map<string, { uid: string; until: number }>();

export async function verifySession(cookie: string): Promise<string | null> {
    const key = createHash("sha256").update(cookie).digest("base64url");
    const now = Date.now();

    const hit = verified.get(key);
    if (hit && hit.until > now) {
        // Still confirms the cookie has not expired since it was cached.
        try {
            const decoded = await getAdminAuth().verifySessionCookie(cookie, false);
            return decoded.uid === hit.uid ? hit.uid : null;
        } catch {
            verified.delete(key);
            return null;
        }
    }

    try {
        const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
        if (verified.size > 5000) {
            for (const [k, v] of verified) if (v.until <= now) verified.delete(k);
            if (verified.size > 5000) verified.clear();
        }
        verified.set(key, { uid: decoded.uid, until: Math.min(now + TTL_MS, decoded.exp * 1000) });
        return decoded.uid;
    } catch {
        verified.delete(key);
        return null;
    }
}

/** Drops a cached verification, for when a session is ended on purpose. */
export function forgetSession(cookie: string): void {
    verified.delete(createHash("sha256").update(cookie).digest("base64url"));
}
