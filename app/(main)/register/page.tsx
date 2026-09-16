"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { destinationAfterSignIn } from "@/lib/next-destination";
import { useState } from "react";
import { Mail, Lock, User, Eye, EyeOff, Phone } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { registerWithEmail, signInWithSocial, type SocialProviderId } from "@/lib/firebase/auth";
import { DEFAULT_DIAL_CODE } from "@/lib/countryCodes";
import { SocialAuth } from "@/components/auth/social-auth";
import { TermsAgreement } from "@/components/auth/terms-agreement";
import { CountryCodeCombobox } from "@/components/auth/country-code-combobox";
import { signUpErrorMessage, isUserCancelled } from "@/lib/auth-errors";

export default function RegisterPage() {
    const router = useRouter();
    const [showPassword, setShowPassword] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
    const [phoneNumber, setPhoneNumber] = useState("");
    const [agreed, setAgreed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await registerWithEmail({ fullName: name, email, password, phoneDialCode: dialCode, phoneNumber });
            router.push(destinationAfterSignIn());
        } catch (err) {
            // Firebase's own message used to reach the screen, which showed the
            // raw auth/... code and read like a crash.
            setError(signUpErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleSocial = async (provider: SocialProviderId) => {
        if (!agreed) {
            setError("Please accept the Terms of Service and Privacy Policy to continue.");
            return;
        }
        setError(null);
        setLoading(true);
        try {
            await signInWithSocial(provider);
            router.push(destinationAfterSignIn());
        } catch (err) {
            // A closed popup is the user changing their mind, not a failure.
            setError(isUserCancelled(err) ? null : signUpErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-4 sm:py-6 bg-[var(--background-secondary)]">
            <div className="w-full max-w-md p-4 sm:p-5 rounded-2xl bg-card border border-card shadow-sm">
                <Link href="/" className="flex items-center gap-2 text-xl font-bold text-fg mb-3 sm:mb-4">
                    <Logo size={26} className="shrink-0" />
                    PDF <span className="text-[var(--primary)]">AI</span> Assistant
                </Link>

                <h1 className="text-xl sm:text-2xl font-bold text-fg mb-1">Create your account</h1>
                <p className="text-muted text-sm mb-3 sm:mb-4">Start using every PDF tool for free</p>

                {error && (
                    <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-[var(--primary)] text-xs">{error}</div>
                )}

                {/*
                    autoComplete is off across this form on purpose. Every field
                    starts empty in state, but the browser was filling the phone
                    and password from whatever it had saved for this site — so a
                    fresh visitor met a sign-up form that already had someone
                    else's details in it, styled in the browser's autofill
                    colour. Signing up is the one form where nothing should be
                    pre-filled; the country code is the exception because it is
                    our default rather than a remembered value.

                    The password gets "new-password" instead of "off": Chrome
                    ignores "off" on password fields and only stops offering a
                    saved credential when told the field is for a new one.
                */}
                <form onSubmit={handleSubmit} className="space-y-2.5" autoComplete="off">
                    <div>
                        <label className="text-sm text-fg mb-0.5 block">Full name</label>
                        <div className="relative">
                            <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                type="text"
                                required
                                autoComplete="off"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Your name"
                                className="w-full pl-10 pr-4 py-2 rounded-xl bg-card border border-card text-fg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm text-fg mb-0.5 block">Email</label>
                        <div className="relative">
                            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                type="email"
                                required
                                autoComplete="off"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                className="w-full pl-10 pr-4 py-2 rounded-xl bg-card border border-card text-fg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm text-fg mb-0.5 block">Phone number</label>
                        <div className="flex gap-2">
                            <CountryCodeCombobox value={dialCode} onChange={setDialCode} />
                            <div className="relative flex-1">
                                <Phone size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                                <input
                                    type="tel"
                                    required
                                    autoComplete="off"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ""))}
                                    placeholder="300 1234567"
                                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-card border border-card text-fg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm text-fg mb-0.5 block">Password</label>
                        <div className="relative">
                            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input
                                type={showPassword ? "text" : "password"}
                                required
                                minLength={6}
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Create a password"
                                className="w-full pl-10 pr-10 py-2 rounded-xl bg-card border border-card text-fg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
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

                    <TermsAgreement checked={agreed} onChange={setAgreed} id="register-terms" />

                    <button
                        type="submit"
                        disabled={loading || !agreed}
                        className="w-full py-2 rounded-xl bg-[var(--primary)] text-white font-medium hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {loading ? "Creating account..." : "Create Account"}
                    </button>
                </form>

                <SocialAuth action="Sign up" disabled={loading} onSelect={handleSocial} />

                <p className="text-center text-sm text-muted mt-3">
                    Already have an account?{" "}
                    <Link href="/login" className="text-[var(--primary)] hover:underline">
                        Log in
                    </Link>
                </p>
            </div>
        </main>
    );
}