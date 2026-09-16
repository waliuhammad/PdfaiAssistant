import {
    createUserWithEmailAndPassword,
    updateProfile,
    signInWithPopup,
    GoogleAuthProvider,
    GithubAuthProvider,
    type AuthProvider,
    type User,
} from "firebase/auth";
import { getFirebaseAuth, getDb } from "./client";

/**
 * Hand the server an ID token so it can set an httpOnly session cookie.
 *
 * Without this the server has no idea anyone is signed in — Firebase keeps its
 * state in IndexedDB, which only the browser can read — and proxy.ts would turn
 * every visitor away from the signed-in area.
 */
async function startServerSession(user: User) {
    try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
        });
        if (!res.ok) {
            // Sign-in itself worked; the visitor would just bounce off the
            // signed-in area, so make the reason visible rather than silent.
            console.error("Could not start a server session:", await res.text());
        }
    } catch (err) {
        console.error("Could not start a server session:", err);
    }
}

export interface RegisterInput {
    fullName: string;
    email: string;
    password: string;
    phoneDialCode: string;
    phoneNumber: string;
}

/**
 * Best-effort: the account already exists in Firebase Auth by the time this
 * runs, so a Firestore failure (rules, quota, offline) must not surface as a
 * failed sign-in. Matches how getUserProfile already tolerates Firestore.
 */
async function createUserDocIfNotExists(user: User, extra?: Record<string, unknown>) {
    try {
        // Registering is the one moment this page needs Firestore, so it loads here.
        const [{ doc, setDoc, getDoc, serverTimestamp }, db] = await Promise.all([
            import("firebase/firestore"),
            getDb(),
        ]);

        const userRef = doc(db, "users", user.uid);
        const existing = await getDoc(userRef);
        if (!existing.exists()) {
            await setDoc(userRef, {
                fullName: user.displayName ?? extra?.fullName ?? "",
                email: user.email,
                phone: extra?.phone ?? null,
                plan: "free",
                createdAt: serverTimestamp(),
            });
        }
    } catch (err) {
        console.warn("Could not create the user document in Firestore:", err);
    }
}

export async function registerWithEmail(input: RegisterInput) {
    const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), input.email, input.password);
    await updateProfile(credential.user, { displayName: input.fullName });
    await createUserDocIfNotExists(credential.user, {
        fullName: input.fullName,
        phone: `${input.phoneDialCode}${input.phoneNumber}`,
    });
    await startServerSession(credential.user);
    return credential.user;
}

/**
 * The two providers the sign-in pages offer. Facebook, X and Apple are not
 * among them and have no builder here — a provider nothing can ask for is a
 * provider that only rots. Apple in particular was removed rather than left
 * switched off: it needs a paid Apple Developer account behind it, and until
 * that exists its button only ever produced auth/operation-not-allowed.
 *
 * Both must be switched on in the Firebase console. Where one is not, Firebase
 * answers auth/operation-not-allowed, which the pages turn into "that sign-in
 * method isn't enabled for this app yet" rather than a raw error code.
 */
export type SocialProviderId = "google" | "github";

function buildProvider(id: SocialProviderId): AuthProvider {
    switch (id) {
        case "google":
            return new GoogleAuthProvider();
        case "github":
            return new GithubAuthProvider();
    }
}

/**
 * Each provider must also be enabled in the Firebase console; if it isn't,
 * Firebase returns auth/operation-not-allowed, which the caller surfaces.
 */
export async function signInWithSocial(id: SocialProviderId) {
    const credential = await signInWithPopup(getFirebaseAuth(), buildProvider(id));
    await createUserDocIfNotExists(credential.user);
    await startServerSession(credential.user);
    return credential.user;
}
import { signInWithEmailAndPassword } from "firebase/auth";

export async function signInWithEmail(email: string, password: string) {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    await startServerSession(credential.user);
    return credential.user;
}
import { signOut as firebaseSignOut } from "firebase/auth";

export async function logout() {
    await firebaseSignOut(getFirebaseAuth());

    // Clear the server session too. Signing out of Firebase only clears the
    // browser's copy; the cookie would keep letting the proxy through.
    try {
        await fetch("/api/auth/session", { method: "DELETE" });
    } catch (err) {
        console.error("Could not clear the server session:", err);
    }
}
import { sendPasswordResetEmail, confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";

export async function sendResetEmail(email: string) {
    await sendPasswordResetEmail(getFirebaseAuth(), email, {
        url: `${window.location.origin}/login`, // where Firebase sends them after successful reset
    });
}

export async function verifyResetCode(oobCode: string) {
    // Returns the user's email if the code is valid, throws if expired/invalid
    return await verifyPasswordResetCode(getFirebaseAuth(), oobCode);
}

export async function confirmReset(oobCode: string, newPassword: string) {
    await confirmPasswordReset(getFirebaseAuth(), oobCode, newPassword);
}

import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";

/** True when the account signs in with a password rather than only Google or GitHub. */
export function hasPasswordProvider(user: User | null) {
    return !!user?.providerData.some((provider) => provider.providerId === "password");
}

export async function changePassword(currentPassword: string, newPassword: string) {
    const user = getFirebaseAuth().currentUser;
    if (!user?.email) throw new Error("You need to be signed in to change your password.");

    // Firebase requires a recent login before it will accept a password change.
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
}
import { reauthenticateWithPopup } from "firebase/auth";

/**
 * Signs the current user in again and returns a fresh ID token, for actions
 * the server only accepts from a sign-in made moments ago (deleting the
 * account). Password accounts confirm with their password; Google and GitHub
 * accounts through the provider's popup.
 */
export async function confirmIdentity(password?: string): Promise<string> {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("You need to be signed in.");

    if (hasPasswordProvider(user)) {
        if (!user.email || !password) throw new Error("Enter your password to confirm.");
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    } else {
        const providerId = user.providerData[0]?.providerId;
        const id: SocialProviderId = providerId === "github.com" ? "github" : "google";
        await reauthenticateWithPopup(user, buildProvider(id));
    }

    return user.getIdToken(true);
}
