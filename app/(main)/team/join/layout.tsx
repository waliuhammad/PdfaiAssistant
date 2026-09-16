import type { Metadata } from "next";

// An invite landing page is only reachable from a private link.
export const metadata: Metadata = {
    title: "Join a team",
    robots: { index: false, follow: false },
};

export default function JoinTeamLayout({ children }: { children: React.ReactNode }) {
    return children;
}
