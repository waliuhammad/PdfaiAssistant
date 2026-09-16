"use client";

/**
 * Picking files from Google Drive and Dropbox, returned as ordinary File
 * objects so every tool can take them exactly as it takes a file from disk.
 *
 * Each provider is inert until its keys are set. Nothing is loaded on a page
 * that has no key for it, and the upload card hides a source it cannot open,
 * so an unconfigured deployment looks the same as it did before this existed.
 *
 * The provider scripts are fetched on first use rather than at page load. There
 * are twenty-one tool pages and most visits never touch a cloud picker; paying
 * for two Google libraries and Dropbox's on every one of them would be the
 * wrong trade.
 */

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
/** The Cloud project *number*, which the Picker needs to grant file access. */
const GOOGLE_APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
const DROPBOX_APP_KEY = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY ?? "";

export function isGoogleDriveConfigured(): boolean {
    return Boolean(GOOGLE_API_KEY && GOOGLE_CLIENT_ID && GOOGLE_APP_ID);
}

export function isDropboxConfigured(): boolean {
    return Boolean(DROPBOX_APP_KEY);
}

export interface PickOptions {
    /** The same string the file input takes: ".docx,.doc", "image/*", … */
    accept: string;
    multiple: boolean;
}

/** Thrown when the person closes a picker. Not an error worth showing. */
export class PickCancelled extends Error {
    constructor() {
        super("cancelled");
        this.name = "PickCancelled";
    }
}

// ---------------------------------------------------------------------------
// What a tool will accept, in the vocabularies the two pickers understand
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];

const MIME_TO_EXT: Record<string, string> = Object.fromEntries(
    Object.entries(EXT_TO_MIME).map(([ext, mime]) => [mime, ext])
);

/** Every concrete MIME type an accept string allows. */
function acceptedMimes(accept: string): string[] {
    const out = new Set<string>();
    for (const raw of accept.split(",")) {
        const token = raw.trim().toLowerCase();
        if (!token) continue;
        if (token === "image/*") IMAGE_MIMES.forEach((m) => out.add(m));
        else if (token.startsWith(".")) {
            const mime = EXT_TO_MIME[token];
            if (mime) out.add(mime);
        } else if (token.includes("/")) out.add(token);
    }
    return [...out];
}

/**
 * Google's own formats, and what each can be exported as.
 *
 * A Google Doc has no bytes of its own — it has to be exported. Offering them
 * is worth it: a lot of people's documents are Google Docs, and "open it in
 * Drive, download as PDF, then upload the PDF" is exactly the chore this
 * feature exists to remove.
 */
const GOOGLE_NATIVE: Record<string, string[]> = {
    "application/vnd.google-apps.document": [
        EXT_TO_MIME[".docx"],
        "application/pdf",
    ],
    "application/vnd.google-apps.spreadsheet": [
        EXT_TO_MIME[".xlsx"],
        "text/csv",
        "application/pdf",
    ],
    "application/vnd.google-apps.presentation": [
        EXT_TO_MIME[".pptx"],
        "application/pdf",
    ],
};

/** The export format to use for a native Google file, or null if none fits. */
function exportTargetFor(nativeMime: string, wanted: string[]): string | null {
    return GOOGLE_NATIVE[nativeMime]?.find((m) => wanted.includes(m)) ?? null;
}

function dropboxExtensions(accept: string): string[] {
    const out = new Set<string>();
    for (const raw of accept.split(",")) {
        const token = raw.trim().toLowerCase();
        if (token === "image/*") out.add("images");
        else if (token.startsWith(".")) out.add(token);
        else if (MIME_TO_EXT[token]) out.add(MIME_TO_EXT[token]);
    }
    return [...out];
}

// ---------------------------------------------------------------------------
// Script loading
// ---------------------------------------------------------------------------

const loading = new Map<string, Promise<void>>();

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
    const existing = loading.get(src);
    if (existing) return existing;

    const promise = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
        script.onload = () => resolve();
        script.onerror = () => {
            // Forget the failure, so a later click can try again once the
            // network is back instead of being stuck with a rejected promise.
            loading.delete(src);
            reject(new Error(`Could not load ${new URL(src).hostname}`));
        };
        document.head.appendChild(script);
    });

    loading.set(src, promise);
    return promise;
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

interface PickerDoc {
    id: string;
    name: string;
    mimeType: string;
}

interface GoogleGlobals {
    gapi: { load: (lib: string, cb: () => void) => void };
    google: {
        accounts: {
            oauth2: {
                initTokenClient: (cfg: {
                    client_id: string;
                    scope: string;
                    callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void;
                    error_callback?: (e: { type?: string }) => void;
                }) => { requestAccessToken: (o?: { prompt?: string }) => void };
            };
        };
        picker: {
            DocsView: new (viewId?: string) => {
                setMimeTypes: (m: string) => unknown;
                setIncludeFolders: (b: boolean) => unknown;
                setSelectFolderEnabled: (b: boolean) => unknown;
            };
            ViewId: { DOCS: string };
            PickerBuilder: new () => PickerBuilder;
            Feature: { MULTISELECT_ENABLED: string; NAV_HIDDEN: string };
            Action: { PICKED: string; CANCEL: string };
            Response: { ACTION: string; DOCUMENTS: string };
            Document: { ID: string; NAME: string; MIME_TYPE: string };
        };
    };
}

interface PickerBuilder {
    setAppId: (id: string) => PickerBuilder;
    setOAuthToken: (t: string) => PickerBuilder;
    setDeveloperKey: (k: string) => PickerBuilder;
    addView: (v: unknown) => PickerBuilder;
    enableFeature: (f: string) => PickerBuilder;
    setCallback: (cb: (data: Record<string, unknown>) => void) => PickerBuilder;
    build: () => { setVisible: (v: boolean) => void };
}

const g = () => window as unknown as GoogleGlobals;

/** Kept for the life of the page so a second pick does not ask again. */
let driveToken: { value: string; expiresAt: number } | null = null;

/**
 * Loads the Google libraries. Called on hover as well as on click, so that by
 * the time the button is pressed the sign-in popup can open inside the same
 * gesture — browsers block popups that open too long after one.
 */
export async function prepareGoogleDrive(): Promise<void> {
    if (!isGoogleDriveConfigured()) return;
    await Promise.all([
        loadScript("https://apis.google.com/js/api.js").then(
            () => new Promise<void>((resolve) => g().gapi.load("picker", resolve))
        ),
        loadScript("https://accounts.google.com/gsi/client"),
    ]);
}

function requestDriveToken(): Promise<string> {
    if (driveToken && driveToken.expiresAt > Date.now() + 60_000) {
        return Promise.resolve(driveToken.value);
    }

    return new Promise((resolve, reject) => {
        const client = g().google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            // drive.file only reaches the files the person picks here. It is
            // also the scope Google treats as non-sensitive, so the app does
            // not need to go through their restricted-scope review.
            scope: "https://www.googleapis.com/auth/drive.file",
            callback: (r) => {
                if (r.error || !r.access_token) {
                    reject(r.error === "access_denied" ? new PickCancelled() : new Error("Google sign-in failed."));
                    return;
                }
                driveToken = {
                    value: r.access_token,
                    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
                };
                resolve(r.access_token);
            },
            error_callback: (e) => {
                reject(e.type === "popup_closed" ? new PickCancelled() : new Error("Google sign-in was blocked."));
            },
        });
        client.requestAccessToken({ prompt: driveToken ? "" : undefined });
    });
}

function showDrivePicker(token: string, opts: PickOptions): Promise<PickerDoc[]> {
    const { google } = g();
    const wanted = acceptedMimes(opts.accept);
    const nativeAllowed = Object.keys(GOOGLE_NATIVE).filter((n) => exportTargetFor(n, wanted));

    return new Promise((resolve, reject) => {
        const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
        view.setMimeTypes([...wanted, ...nativeAllowed].join(","));
        view.setIncludeFolders(true);
        view.setSelectFolderEnabled(false);

        let builder = new google.picker.PickerBuilder()
            .setAppId(GOOGLE_APP_ID)
            .setOAuthToken(token)
            .setDeveloperKey(GOOGLE_API_KEY)
            .addView(view)
            .setCallback((data) => {
                const action = data[google.picker.Response.ACTION];
                if (action === google.picker.Action.CANCEL) reject(new PickCancelled());
                if (action !== google.picker.Action.PICKED) return;

                const docs = (data[google.picker.Response.DOCUMENTS] as Record<string, string>[]) ?? [];
                resolve(
                    docs.map((d) => ({
                        id: d[google.picker.Document.ID],
                        name: d[google.picker.Document.NAME],
                        mimeType: d[google.picker.Document.MIME_TYPE],
                    }))
                );
            });

        if (opts.multiple) builder = builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
        builder.build().setVisible(true);
    });
}

async function downloadDriveFile(doc: PickerDoc, token: string, wanted: string[]): Promise<File> {
    const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}`;
    const target = GOOGLE_NATIVE[doc.mimeType] ? exportTargetFor(doc.mimeType, wanted) : null;

    const url = target
        ? `${base}/export?mimeType=${encodeURIComponent(target)}`
        : `${base}?alt=media&supportsAllDrives=true`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        // Google caps exports at 10 MB and says so with a 403.
        throw new Error(
            res.status === 403 && target
                ? `"${doc.name}" is too large for Google to export.`
                : `Could not download "${doc.name}" from Google Drive.`
        );
    }

    const blob = await res.blob();
    const type = target ?? doc.mimeType;
    // An exported Doc arrives with no extension, and the tools recognise files
    // partly by name, so give it the one its new format has.
    const ext = target ? (MIME_TO_EXT[target] ?? ".pdf") : "";
    const name = ext && !doc.name.toLowerCase().endsWith(ext) ? `${doc.name}${ext}` : doc.name;
    return new File([blob], name, { type });
}

export async function pickFromGoogleDrive(opts: PickOptions): Promise<File[]> {
    await prepareGoogleDrive();
    const token = await requestDriveToken();
    const docs = await showDrivePicker(token, opts);
    const wanted = acceptedMimes(opts.accept);
    // One at a time: several large parallel downloads on a phone connection
    // are more likely to fail together than to finish sooner.
    const files: File[] = [];
    for (const doc of docs) files.push(await downloadDriveFile(doc, token, wanted));
    return files;
}

// ---------------------------------------------------------------------------
// Dropbox
// ---------------------------------------------------------------------------

interface DropboxFile {
    name: string;
    link: string;
    bytes: number;
}

interface DropboxGlobal {
    Dropbox?: {
        choose: (o: {
            success: (files: DropboxFile[]) => void;
            cancel: () => void;
            linkType: "direct" | "preview";
            multiselect: boolean;
            extensions?: string[];
            folderselect: boolean;
            sizeLimit?: number;
        }) => void;
    };
}

export async function prepareDropbox(): Promise<void> {
    if (!isDropboxConfigured()) return;
    await loadScript("https://www.dropbox.com/static/api/2/dropins.js", {
        id: "dropboxjs",
        "data-app-key": DROPBOX_APP_KEY,
    });
}

const MIME_BY_EXT_LOOKUP = (name: string): string => {
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
        return ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
    }
    return "application/octet-stream";
};

/** The upload limit every tool route enforces, so a pick fails here rather than after a long download. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function pickFromDropbox(opts: PickOptions): Promise<File[]> {
    await prepareDropbox();
    const dropbox = (window as unknown as DropboxGlobal).Dropbox;
    if (!dropbox) throw new Error("Dropbox did not load.");

    const extensions = dropboxExtensions(opts.accept);

    const picked = await new Promise<DropboxFile[]>((resolve, reject) => {
        dropbox.choose({
            success: resolve,
            cancel: () => reject(new PickCancelled()),
            // Direct links are fetchable from the page; preview links are an
            // HTML page about the file, not the file.
            linkType: "direct",
            multiselect: opts.multiple,
            extensions: extensions.length ? extensions : undefined,
            folderselect: false,
            sizeLimit: MAX_BYTES,
        });
    });

    const files: File[] = [];
    for (const f of picked) {
        const res = await fetch(f.link);
        if (!res.ok) throw new Error(`Could not download "${f.name}" from Dropbox.`);
        const blob = await res.blob();
        files.push(new File([blob], f.name, { type: blob.type || MIME_BY_EXT_LOOKUP(f.name) }));
    }
    return files;
}

// ---------------------------------------------------------------------------

/** Wraps picked files in a FileList, which is what every tool's handler takes. */
export function toFileList(files: File[]): FileList {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    return dt.files;
}
