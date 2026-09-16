"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { SiDropbox, SiGoogledrive, SiIcloud } from "react-icons/si";
import {
    isDropboxConfigured,
    isGoogleDriveConfigured,
    pickFromDropbox,
    pickFromGoogleDrive,
    PickCancelled,
    prepareDropbox,
    prepareGoogleDrive,
    toFileList,
} from "@/lib/cloud-pickers";

const subscribeToNothing = () => () => { };

/**
 * Whether this is an Apple device, where the system file picker already opens
 * onto iCloud Drive.
 *
 * Apple offers no picker a website can call — iCloud Drive is reached through
 * the operating system's own file dialog, which is the one the upload box opens
 * anyway. So the iCloud button is that dialog, offered by name to the people
 * for whom it genuinely lands in iCloud. Elsewhere it would just be a second
 * "browse" button with a misleading label, so it is not shown.
 *
 * iPadOS reports itself as a Mac, which is fine: it has iCloud Drive too.
 */
function isApplePlatform(): boolean {
    return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

type Source = "drive" | "dropbox";

/**
 * "Or import from" — the cloud sources under a tool's upload box.
 *
 * Every button stops its click from reaching the box around it. The whole box
 * is a click target that opens the local file dialog, so without that a click
 * on "Google Drive" would open both.
 */
export function CloudSources({
    accept,
    multiple,
    disabled,
    onFiles,
    onPickLocal,
}: {
    accept: string;
    multiple: boolean;
    disabled: boolean;
    onFiles: (files: FileList) => void;
    /** Opens the device's own file dialog — the iCloud route on Apple devices. */
    onPickLocal: () => void;
}) {
    const apple = useSyncExternalStore(subscribeToNothing, isApplePlatform, () => false);
    const [busy, setBusy] = useState<Source | null>(null);
    const [error, setError] = useState<string | null>(null);

    const drive = isGoogleDriveConfigured();
    const dropbox = isDropboxConfigured();

    if (!drive && !dropbox && !apple) return null;

    const pick = async (source: Source) => {
        if (disabled || busy) return;
        setError(null);
        setBusy(source);
        try {
            const files =
                source === "drive"
                    ? await pickFromGoogleDrive({ accept, multiple })
                    : await pickFromDropbox({ accept, multiple });
            if (files.length) onFiles(toFileList(files));
        } catch (err) {
            if (!(err instanceof PickCancelled)) {
                setError(err instanceof Error ? err.message : "Could not import that file.");
            }
        } finally {
            setBusy(null);
        }
    };

    // Swallows the event before the upload box sees it.
    const guard = (e: React.SyntheticEvent) => e.stopPropagation();

    const buttonClass =
        "inline-flex items-center gap-2 rounded-xl border border-card bg-card px-3 py-2 text-xs font-medium text-fg " +
        "transition-colors hover:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";

    return (
        <div className="mt-5" onClick={guard} onKeyDown={guard}>
            <p className="text-[11px] uppercase tracking-wide text-muted">or import from</p>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {drive && (
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={disabled || busy !== null}
                        // Loading ahead of the click keeps Google's sign-in popup
                        // inside the gesture that asked for it.
                        onPointerEnter={() => void prepareGoogleDrive().catch(() => { })}
                        onFocus={() => void prepareGoogleDrive().catch(() => { })}
                        onClick={() => pick("drive")}
                    >
                        {busy === "drive" ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <SiGoogledrive size={14} className="text-[#1FA463]" />
                        )}
                        Google Drive
                    </button>
                )}

                {dropbox && (
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={disabled || busy !== null}
                        onPointerEnter={() => void prepareDropbox().catch(() => { })}
                        onFocus={() => void prepareDropbox().catch(() => { })}
                        onClick={() => pick("dropbox")}
                    >
                        {busy === "dropbox" ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <SiDropbox size={14} className="text-[#0061FE]" />
                        )}
                        Dropbox
                    </button>
                )}

                {apple && (
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={disabled || busy !== null}
                        title="Opens your device's file picker, where iCloud Drive is listed"
                        onClick={onPickLocal}
                    >
                        <SiIcloud size={14} className="text-[#3693F3]" />
                        iCloud Drive
                    </button>
                )}
            </div>

            {busy && (
                <p className="mt-2 text-[11px] text-muted" aria-live="polite">
                    Importing…
                </p>
            )}
            {error && (
                <p className="mt-2 text-[11px] text-red-600 dark:text-red-400" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
