"use client";

import { useRef, useState } from "react";
import { Upload, X, FileText, ShieldCheck } from "lucide-react";
import { CloudSources } from "./cloud-sources";

/**
 * The one upload area every tool uses.
 *
 * Each tool page had grown its own: padding ran from p-6 to p-16, corners from
 * rounded-xl to rounded-3xl, and seventeen of them hardcoded their own dark
 * hex values, so no two pages looked alike and none followed the theme. This
 * takes its colours from the design tokens, which means it also follows the
 * light/dark switch without a `dark:` variant for every rule.
 *
 * The width is capped here rather than left to the page, because the tool
 * pages run from max-w-xl to max-w-7xl and the box came out a different size
 * on every one of them.
 *
 * Files arrive three ways — dropped, browsed, or imported from a cloud drive —
 * and all three reach the tool through onFiles as a FileList.
 */
export function UploadCard({
    onFiles,
    accept = "application/pdf",
    multiple = false,
    title = "Drag & drop your PDF here",
    hint = "or click to browse",
    disabled = false,
}: {
    onFiles: (files: FileList | null) => void;
    accept?: string;
    multiple?: boolean;
    title?: string;
    hint?: string;
    disabled?: boolean;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const open = () => {
        if (!disabled) inputRef.current?.click();
    };

    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                }
            }}
            onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!disabled) onFiles(e.dataTransfer.files);
            }}
            className={`mx-auto w-full max-w-[624px] rounded-3xl border p-8 sm:p-12 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${disabled
                    ? "cursor-not-allowed opacity-60 border-card bg-[var(--background-secondary)]"
                    : dragging
                        ? "cursor-pointer border-[var(--primary)] bg-primary-tint"
                        : "cursor-pointer border-card bg-[var(--background-secondary)] hover:border-[var(--primary)]"
                }`}
        >
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                multiple={multiple}
                hidden
                onChange={(e) => {
                    onFiles(e.target.files);
                    // Let the same file be picked twice in a row.
                    e.target.value = "";
                }}
            />

            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-card bg-card shadow-sm">
                <Upload className="text-fg" size={20} />
            </div>

            <p className="text-[var(--primary)] font-semibold text-sm">{title}</p>
            <p className="text-muted text-xs mt-1">{hint}</p>

            {/* Inside the box, so a tool gets cloud import by using the box and
                nothing else. The picked files arrive through the same onFiles as
                a file from disk, so no tool had to change. */}
            <CloudSources
                accept={accept}
                multiple={multiple}
                disabled={disabled}
                onFiles={onFiles}
                onPickLocal={open}
            />
        </div>
    );
}

/**
 * The reassurance line every tool ends with. It sits below the upload box
 * rather than inside it — a few tools used to tuck it under a divider within
 * the box, which made those boxes taller than the rest.
 */
export function SecureNote() {
    return (
        <div className="pt-5 sm:pt-6 flex flex-wrap items-center justify-center gap-1.5 text-center text-muted text-[11px] sm:text-xs">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Secure processing • Files processed privately</span>
        </div>
    );
}

/** The selected-file row that sits where the upload card was. */
export function FileChip({
    name,
    size,
    onRemove,
}: {
    name: string;
    size?: string;
    onRemove?: () => void;
}) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-card">
            <div className="w-9 h-9 rounded-lg bg-primary-tint flex items-center justify-center shrink-0">
                <FileText size={16} className="text-[var(--primary)]" />
            </div>
            <div className="flex-1 min-w-0 text-left">
                <p className="text-fg text-sm truncate">{name}</p>
                {size && <p className="text-muted text-xs">{size}</p>}
            </div>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove ${name}`}
                    className="text-muted hover:text-[var(--primary)] shrink-0"
                >
                    <X size={16} />
                </button>
            )}
        </div>
    );
}