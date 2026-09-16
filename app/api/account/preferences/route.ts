import { NextRequest, NextResponse } from "next/server";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAdminApp, isAdminConfigured } from "@/lib/firebase/admin";
import { getRequestUid } from "@/lib/server-auth";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n/messages";
import type { NotificationPrefs } from "@/lib/email";

/**
 * Saves the settings page's preferences against the account, so the email
 * switches actually govern what is sent and follow the person between devices.
 *
 * Written through here rather than by the browser straight to Firestore: the
 * rules keep `preferences` server-only, so only the shapes checked below can
 * ever be stored.
 */

export const runtime = "nodejs";

const LANGUAGE_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));
const SWITCHES: (keyof NotificationPrefs)[] = ["email", "product", "marketing"];

export async function PUT(req: NextRequest) {
    if (!isAdminConfigured()) {
        return NextResponse.json(
            { success: false, message: "Preferences can't be saved right now." },
            { status: 503 }
        );
    }

    const uid = await getRequestUid(req);
    if (!uid) {
        return NextResponse.json({ success: false, message: "Sign in to continue." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const update: Record<string, unknown> = {};

    if (body?.language !== undefined) {
        if (typeof body.language !== "string" || !LANGUAGE_CODES.has(body.language)) {
            return NextResponse.json({ success: false, message: "Unknown language." }, { status: 400 });
        }
        update["preferences.language"] = body.language;
    }

    if (body?.notifications !== undefined) {
        const n = body.notifications;
        if (!n || typeof n !== "object" || !SWITCHES.every((k) => typeof n[k] === "boolean")) {
            return NextResponse.json(
                { success: false, message: "Invalid notification settings." },
                { status: 400 }
            );
        }
        for (const k of SWITCHES) update[`preferences.notifications.${k}`] = n[k];
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ success: false, message: "Nothing to save." }, { status: 400 });
    }

    try {
        const ref = getFirestore(getAdminApp()).collection("users").doc(uid);
        // update() rather than set(): dotted paths only mean nested fields to
        // update(), and it refuses to create a profile that does not exist.
        await ref.update({ ...update, updatedAt: FieldValue.serverTimestamp() });
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("[preferences] could not save", err);
        return NextResponse.json(
            { success: false, message: "Could not save your preferences. Please try again." },
            { status: 500 }
        );
    }
}
