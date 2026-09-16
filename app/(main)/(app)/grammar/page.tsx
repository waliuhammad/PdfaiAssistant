"use client";

import { useMemo, useState } from "react";
import { DownloadNotice } from "@/components/download-notice";
import { SecureNote, UploadCard } from "@/components/tools/upload-card";
import { AiRunButton } from "@/components/tools/ai-run-button";
import { FeatureLockNotice, useFeatureLock } from "@/components/tools/feature-lock";
import { ResultActions } from "@/components/tools/result-actions";
import { downloadBlob } from "@/lib/download";
import { CheckCheck, Sparkles, FileText, X } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { diffWords, countEdits } from "@/lib/text-diff";
import { useCancellableRun, wasCancelled } from "@/hooks/useCancellableRun";

// Normalizes text coming back from the API: turns literal "\n" sequences
// (backslash + n as two characters) into real line breaks, and collapses
// stray carriage returns from Windows-origin PDFs.
function cleanText(raw: string): string {
    return raw
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\r\n/g, "\n")
        .trim();
}

export default function GrammarCheckerPage() {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const { begin, cancel } = useCancellableRun();
    const { locked } = useFeatureLock("grammar");
    const [fileMeta, setFileMeta] = useState<{ name: string; size: string } | null>(null);
    const [correctedText, setCorrectedText] = useState<string | null>(null);
    const [originalText, setOriginalText] = useState<string | null>(null);
    const [showChanges, setShowChanges] = useState(false);

    // The corrections themselves, worked out here rather than asked of the
    // model: the tool used to show only the result, so there was no way to see
    // what it had altered without reading both versions side by side.
    const diff = useMemo(
        () => (originalText && correctedText ? diffWords(originalText, correctedText) : null),
        [originalText, correctedText]
    );
    const editCount = useMemo(() => (diff ? countEdits(diff) : 0), [diff]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const formatSize = (bytes: number) => {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const handleFile = (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        const f = fileList[0];
        if (f.type !== "application/pdf") {
            setError("Please upload a valid PDF document.");
            return;
        }
        setError(null);
        setSelectedFile(f);
        setFileMeta({ name: f.name, size: formatSize(f.size) });
        setCorrectedText(null);
    };

    const handleCheckGrammar = async () => {
      const signal = begin();
        if (!selectedFile || loading) return;

        setLoading(true);
        setError(null);
        setCorrectedText(null);

        try {
            const formData = new FormData();
formData.append("file", selectedFile);

const res = await fetch("/api/grammar", {
    method: "POST",
    body: formData, signal });

const data = await res.json();

if (!res.ok) {
    throw new Error(
        data.message || "Failed to process document grammar correction."
    );
}

            // Log the raw shape once so it's easy to check in DevTools
            // console exactly what the AI microservice actually returned,
            // without ever rendering that raw object as if it were text.
            console.log("Grammar API response:", data);

            // Only ever read an actual text field — never fall back to
            // dumping the raw API response, which is what was surfacing
            // the success flag / page count / downloadable flag as if it
            // were the corrected text. Checks a few common shapes since
            // the underlying AI service's exact field name isn't fixed.
            const rawResult =
                (typeof data.correctedText === "string" && data.correctedText) ||
                (typeof data.reply === "string" && data.reply) ||
                (typeof data.response === "string" && data.response) ||
                (typeof data.text === "string" && data.text) ||
                (typeof data.result === "string" && data.result) ||
                (typeof data?.result?.correctedText === "string" && data.result.correctedText) ||
                (typeof data?.result?.text === "string" && data.result.text) ||
                (typeof data?.data?.correctedText === "string" && data.data.correctedText) ||
                (typeof data?.data?.text === "string" && data.data.text) ||
                "";

            const rawOriginal =
                (typeof data.originalText === "string" && data.originalText) ||
                (typeof data?.result?.originalText === "string" && data.result.originalText) ||
                (typeof data?.data?.originalText === "string" && data.data.originalText) ||
                "";

            if (!rawResult) {
                setError("No corrected text was returned for this document.");
                setCorrectedText(null);
                setOriginalText(null);
                return;
            }

            setCorrectedText(cleanText(rawResult));
            // Only present once the AI service returns it. Without it the diff
            // view is hidden rather than shown empty.
            setOriginalText(rawOriginal ? cleanText(rawOriginal) : null);
        } catch (err) {
      if (wasCancelled(err, signal)) return;
            setError(errorMessage(err, "Something went wrong connecting to the server."));
        } finally {
            setLoading(false);
        }
    };

    // Base filename (without extension) used to name downloaded files.
    const baseName = (fileMeta?.name || "document").replace(/\.pdf$/i, "");

    const downloadAsTxt = () => {
        if (!correctedText) return;
        const blob = new Blob([correctedText], { type: "text/plain;charset=utf-8" });
        downloadBlob(blob, `${baseName}_corrected.txt`);
    };

    const downloadAsPdf = async () => {
        if (!correctedText) return;

        // Loaded on demand so it doesn't add weight until someone actually
        // exports a PDF.
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF({ unit: "mm", format: "a4" });

        // Pull real page dimensions instead of hardcoding them, so
        // pagination works correctly regardless of format/orientation.
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const marginX = 15;
        const marginTop = 20;
        const marginBottom = 20; // reserved space at bottom for the footer
        const maxWidth = pageWidth - marginX * 2;
        const lineHeight = 6;

        let cursorY = marginTop;
        let pageNumber = 1;

        const drawHeader = () => {
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.text("Corrected Text", marginX, cursorY);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            cursorY += 10;
        };

        const drawFooter = () => {
            const pageCount = doc.getNumberOfPages();
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(
                `Page ${pageNumber} of ${pageCount}`,
                pageWidth - marginX,
                pageHeight - 10,
                { align: "right" }
            );
            doc.setTextColor(0);
            doc.setFontSize(10);
        };

        const addNewPage = () => {
            doc.addPage();
            pageNumber += 1;
            cursorY = marginTop;
        };

        drawHeader();

        // Split on blank lines first so paragraph breaks are preserved,
        // then wrap each paragraph to the page width.
        const paragraphs = correctedText.split(/\n{2,}/);

        paragraphs.forEach((paragraph, pIndex) => {
            const wrapped = doc.splitTextToSize(paragraph, maxWidth);

            wrapped.forEach((line: string) => {
                // Check BEFORE drawing so a line never gets clipped at the
                // bottom edge — it rolls to a new page instead.
                if (cursorY + lineHeight > pageHeight - marginBottom) {
                    addNewPage();
                }
                doc.text(line, marginX, cursorY);
                cursorY += lineHeight;
            });

            // Gap between paragraphs, except after the last one.
            if (pIndex < paragraphs.length - 1) {
                cursorY += lineHeight * 0.6;
                if (cursorY + lineHeight > pageHeight - marginBottom) {
                    addNewPage();
                }
            }
        });

        // Add footers to every page now that the total page count is known.
        const totalPages = doc.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            pageNumber = i;
            drawFooter();
        }

        doc.save(`${baseName}_corrected.pdf`);
    };

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            <div className="text-center mb-8">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-900/30 flex items-center justify-center mb-4 border border-purple-500/20">
                    <CheckCheck className="text-[var(--primary)]" size={26} />
                </div>
                <h1 className="text-2xl font-bold text-fg">PDF Grammar Checker</h1>
                <p className="text-muted text-sm mt-1">Upload a PDF document to check and correct grammar and spelling automatically.</p>
            </div>

            {locked && (
                <div className="mb-6">
                    <FeatureLockNotice />
                </div>
            )}

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
                    {error}
                </div>
            )}

            {/* Before a file is picked the two panels have nothing to show, so
                the upload box stands on its own at the same size as every
                other tool rather than squeezed into one grid column. */}
            {!fileMeta ? (
                <UploadCard
                    onFiles={handleFile}
                    title={"Drag & drop your PDF here"}
                    hint={"or click to browse files"}
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Upload Panel */}
                    <div className="flex flex-col rounded-2xl bg-card border border-card p-4">
                        <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                            Upload Document
                        </label>

                        <div className="flex-1 flex flex-col justify-between">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5">
                                <div className="w-9 h-9 rounded-lg bg-purple-900/30 flex items-center justify-center shrink-0">
                                    <FileText size={16} className="text-[var(--primary)]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-fg text-sm truncate">{fileMeta.name}</p>
                                    <p className="text-muted text-xs">{fileMeta.size}</p>
                                </div>
                                <button 
                                    onClick={() => { cancel(); setSelectedFile(null); setFileMeta(null); setCorrectedText(null); setError(null); }} 
                                    className="text-muted hover:text-[var(--primary)] shrink-0"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="mt-4 text-center text-xs text-muted">
                                PDF ready for syntax & grammar scanning.
                            </div>
                        </div>

                        <div className="pt-3 border-t border-white/5 mt-3 flex justify-end">
                            <AiRunButton
                                label="Check Grammar"
                                loadingLabel="Analyzing PDF..."
                                loading={loading}
                                disabled={!selectedFile || locked}
                                onClick={handleCheckGrammar}
                            />
                        </div>
                    </div>

                    {/* Output Panel */}
                    <div className="flex flex-col rounded-2xl bg-card border border-card p-4">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
                            <span className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles size={13} className="text-[var(--primary)]" />
                                Corrected Result
                            </span>
                            {correctedText && (
                                <ResultActions
                                    text={correctedText}
                                    onDownloadTxt={downloadAsTxt}
                                    onDownloadPdf={downloadAsPdf}
                                />
                            )}
                        </div>
                        {/* Only offered once the original is available to compare
                            against; older AI-service builds do not return it. */}
                        {diff && (
                            <div className="flex items-center gap-1 p-1 mb-2 rounded-xl border border-card bg-card w-fit">
                                <button
                                    type="button"
                                    onClick={() => setShowChanges(false)}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${!showChanges ? "bg-[var(--primary)] text-white" : "text-muted hover:text-fg"}`}
                                >
                                    Corrected
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowChanges(true)}
                                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${showChanges ? "bg-[var(--primary)] text-white" : "text-muted hover:text-fg"}`}
                                >
                                    Changes ({editCount})
                                </button>
                            </div>
                        )}

                        <div className="w-full flex-1 rounded-lg bg-black/20 p-4 border border-white/5 overflow-y-auto max-h-[220px]">
                            {showChanges && diff ? (
                                editCount === 0 ? (
                                    <p className="text-sm text-muted">
                                        No grammar or spelling changes were needed.
                                    </p>
                                ) : (
                                    <p className="text-sm text-fg whitespace-pre-wrap leading-relaxed">
                                        {diff.map((part, i) =>
                                            part.kind === "removed" ? (
                                                <span
                                                    key={i}
                                                    className="line-through bg-red-500/15 text-red-600 dark:text-red-400 rounded px-0.5"
                                                >
                                                    {part.text}
                                                </span>
                                            ) : part.kind === "added" ? (
                                                <span
                                                    key={i}
                                                    className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium rounded px-0.5"
                                                >
                                                    {part.text}
                                                </span>
                                            ) : (
                                                <span key={i}>{part.text}</span>
                                            )
                                        )}
                                    </p>
                                )
                            ) : correctedText ? (
                                <p className="text-sm text-fg whitespace-pre-wrap leading-relaxed">
                                    {correctedText}
                                </p>
                            ) : (
                                <div className="h-full flex items-center justify-center text-center text-muted text-xs">
                                    Corrected text output will appear here...
                                </div>
                            )}
                        </div>
                        <div className="pt-3 border-t border-white/5 mt-3 flex justify-end">
                            <span className="text-xs text-muted">Powered by AI</span>
                        </div>
                    </div>
                </div>
            )}

            <DownloadNotice message="Corrected document downloaded." />

            <SecureNote />
        </div>
    );
}