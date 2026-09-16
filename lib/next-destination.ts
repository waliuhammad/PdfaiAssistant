/**
 * Where to go after signing in or registering.
 *
 * proxy.ts and the team invite page append ?next= when they send someone to
 * sign in, so they land where they were headed rather than always on the
 * dashboard.
 *
 * Only a path on this site is accepted. Taking the parameter at face value
 * would let a link like /login?next=https://example.com bounce a freshly
 * signed-in visitor straight off the site — the standard open redirect. The
 * leading-slash-but-not-double-slash test rejects both absolute URLs and
 * protocol-relative ones; backslashes are refused because browsers treat
 * "/\" like "//".
 */
export function destinationAfterSignIn(): string {
    if (typeof window === "undefined") return "/dashboard";

    const next = new URLSearchParams(window.location.search).get("next");
    if (next && /^\/(?!\/)/.test(next) && !next.includes("\\")) return next;

    return "/dashboard";
}
