"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, ChevronDown, FileText, FileDown } from "lucide-react";

/**
 * Copy and Download for an AI tool's result.
 *
 * All four AI tools had their own copy of this — the same copied flag, the same
 * menu-open flag, the same click-outside listener and the same markup, written
 * out four times. They had already drifted: grammar's pair were bare text links
 * with no border or background while the other three were bordered pills, and
 * translate's were a size smaller than OCR's and Summarize's. Nobody chose any
 * of that; it is just what four copies do over time.
 *
 * One copy means one appearance. The parts that genuinely differ per tool — the
 * text to copy, and what a .txt or .pdf of it should contain — arrive as props.
 */
export function ResultActions({
    /** The text placed on the clipboard by Copy. */
    text,
    onDownloadTxt,
    onDownloadPdf,
}: {
    text: string;
    onDownloadTxt: () => void;
    onDownloadPdf: () => void | Promise<void>;
}) {
    const [copied, setCopied] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;

        const onPointerDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [menuOpen]);

    const handleCopy = () => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const button =
        "py-2 px-3 rounded-xl border border-[#222430]/10 dark:border-white/20 " +
        "bg-[var(--background-secondary)] text-[#222430] dark:text-white " +
        "hover:bg-[#222430] hover:text-white dark:hover:bg-white dark:hover:text-[#222430] " +
        "transition-all shadow-sm flex items-center gap-1.5 text-xs font-bold whitespace-nowrap";

    const menuItem =
        "w-full text-left px-3.5 py-2.5 text-xs font-semibold flex items-center gap-2 " +
        "transition-colors hover:bg-[#222430]/5 dark:hover:bg-white/10";

    // Wraps rather than overflowing: on a narrow phone the title beside these
    // left too little room, and Download was pushed out past the card's edge.
    return (
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleCopy} className={button}>
                <Copy size={14} />
                {copied ? "Copied" : "Copy"}
            </button>

            {/* Split button: Download opens a small format menu */}
            <div className="relative" ref={menuRef}>
                <button
                    type="button"
                    onClick={() => setMenuOpen((prev) => !prev)}
                    className={button}
                >
                    <Download size={14} />
                    Download
                    <ChevronDown
                        size={12}
                        className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
                    />
                </button>

                {menuOpen && (
                    <div className="absolute right-0 mt-2 w-40 rounded-xl border border-[#222430]/15 dark:border-white/20 bg-[var(--background-secondary)] shadow-lg z-20 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                onDownloadTxt();
                            }}
                            className={menuItem}
                        >
                            <FileText size={14} />
                            Download as .TXT
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                void onDownloadPdf();
                            }}
                            className={`${menuItem} border-t border-[#222430]/10 dark:border-white/10`}
                        >
                            <FileDown size={14} />
                            Download as .PDF
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
