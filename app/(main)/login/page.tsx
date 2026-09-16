"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { signInWithEmail, signInWithSocial, type SocialProviderId } from "@/lib/firebase/auth";
import { SocialAuth } from "@/components/auth/social-auth";
import { TermsNotice } from "@/components/auth/terms-agreement";
import { signInErrorMessage, isUserCancelled } from "@/lib/auth-errors";
import { destinationAfterSignIn } from "@/lib/next-destination";

export default function LoginPage() {
    const router = useRouter();
    const [showPassword, setShowPassword] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await signInWithEmail(email, password);
            router.push(destinationAfterSignIn());
        } catch (err) {
            setError(signInErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleSocial = async (provider: SocialProviderId) => {
        setError(null);
        setLoading(true);
        try {
            await signInWithSocial(provider);
            router.push(destinationAfterSignIn());
        } catch (err) {
            // A closed popup is the user changing their mind, not a failure.
            setError(isUserCancelled(err) ? null : signInErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-10 bg-[var(--background-secondary)]">
            <div className="w-full max-w-md p-6 sm:p-8 rounded-2xl bg-card border border-card shadow-sm">
                <Link href="/" className="flex items-center gap-2 text-xl font-bold text-fg mb-6 sm:mb-8">
                    <Logo size={26} className="shrink-0" />
                    PDF <span className="text-[var(--primary)]">AI</span> Assistant
                </Link>

                <h1 className="text-xl sm:text-2xl font-bold text-fg mb-2">Welcome back</h1>
                <p className="text-muted text-sm mb-6 sm:mb-8">Log in to continue to your account</p>

                {error && (
                    <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-[var(--primary)] text-xs">{error}</div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="text-sm text-fg mb-1 block">Email</label>
                        <div className="relative">
                            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="w-full pl-10 pr-4 py-3 rounded-xl bg-card border border-card text-fg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-sm text-fg">Password</label>
                            <Link href="/forget-password" className="inline-block py-1 text-xs text-[var(--primary)] hover:underline">
                                Forgot password?
                            </Link>
                        </div>
                        <div className="relative">
                            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                type={showPassword ? "text" : "password"}
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full pl-10 pr-10 py-3 rounded-xl bg-card border border-card text-fg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    <TermsNotice />

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-xl bg-[var(--primary)] text-white font-medium hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {loading ? "Logging in..." : "Log In"}
                    </button>
                </form>

                <SocialAuth action="Log in" disabled={loading} onSelect={handleSocial} />

                <p className="text-center text-sm text-muted mt-6">
                    Don&apos;t have an account?{" "}
                    <Link href="/register" className="text-[var(--primary)] hover:underline">
                        Sign up
                    </Link>
                </p>
            </div>
        </main>
    );
}