"use client";

import { useState } from "react";
import { DownloadNotice } from "@/components/download-notice";
import { SecureNote, UploadCard } from "@/components/tools/upload-card";
import { AiRunButton } from "@/components/tools/ai-run-button";
import { ResultActions } from "@/components/tools/result-actions";
import { downloadBlob } from "@/lib/download";
import { FileText, X, ScanText } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { useCancellableRun, wasCancelled } from "@/hooks/useCancellableRun";

// Normalizes text coming back from the OCR API: turns literal "\n"
// sequences (backslash + n as two characters) into real line breaks, and
// collapses stray carriage returns from Windows-origin PDFs.
function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

export default function OcrPdfPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { begin, cancel } = useCancellableRun();
  const [fileMeta, setFileMeta] = useState<{ name: string; size: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Close the download menu on outside click, matching how transient
  // popovers are expected to behave everywhere else in the app.

  const handleFile = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    if (f.type !== "application/pdf") {
      setError("Please upload a valid PDF file.");
      return;
    }
    setError(null);
    setSelectedFile(f);
    setFileMeta({ name: f.name, size: formatSize(f.size) });
    setExtractedText(null);
  };

  const handleOcrScan = async () => {
    const signal = begin();
    if (!selectedFile) return;

    setProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      // Updated to match your API route folder structure: app/api/AI tools/ocr/route.ts
      const res = await fetch("/api/ocr", {
        method: "POST",
        body: formData, signal
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to extract text from document.");
      }

      // Log the raw shape once so it's easy to check in DevTools console
      // exactly what the AI microservice actually returned, without ever
      // rendering that raw object as if it were extracted text.
      console.log("OCR API response:", data);

      // Only ever read an actual text field — never fall back to dumping
      // the raw API response, which is what was surfacing the success
      // flag / page count / word count as if it were extracted text.
      // Checks a few common shapes since the underlying AI service's
      // exact field name isn't fixed.
      const rawText =
        (typeof data.text === "string" && data.text) ||
        (typeof data.extractedText === "string" && data.extractedText) ||
        (typeof data.ocrText === "string" && data.ocrText) ||
        (typeof data.content === "string" && data.content) ||
        (typeof data.result === "string" && data.result) ||
        (typeof data?.result?.text === "string" && data.result.text) ||
        (typeof data?.result?.extractedText === "string" && data.result.extractedText) ||
        (typeof data?.data?.text === "string" && data.data.text) ||
        (typeof data?.data?.extractedText === "string" && data.data.extractedText) ||
        "";

      if (!rawText) {
        setError("No text could be extracted from this document.");
        setExtractedText(null);
        return;
      }

      setExtractedText(cleanExtractedText(rawText));
    } catch (err) {
      if (wasCancelled(err, signal)) return;
      setError(errorMessage(err, "Something went wrong connecting to the server."));
    } finally {
      setProcessing(false);
    }
  };

  // Base filename (without extension) used to name downloaded files, e.g.
  // "invoice_scan.pdf" -> "invoice_scan_extracted.txt".
  const baseName = (fileMeta?.name || "document").replace(/\.pdf$/i, "");

  const downloadAsTxt = () => {
    if (!extractedText) return;
    const blob = new Blob([extractedText], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${baseName}_extracted.txt`);
  };

  const downloadAsPdf = async () => {
    if (!extractedText) return;

    // Loaded on demand so it doesn't add weight until someone actually
    // exports a PDF.
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    // Pull real page dimensions instead of hardcoding them, so pagination
    // works correctly regardless of format/orientation.
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
      doc.text("Extracted Text", marginX, cursorY);
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

    // Split on blank lines first so paragraph breaks are preserved, then
    // wrap each paragraph to the page width.
    const paragraphs = extractedText.split(/\n{2,}/);

    paragraphs.forEach((paragraph, pIndex) => {
      const wrapped = doc.splitTextToSize(paragraph, maxWidth);

      wrapped.forEach((line: string) => {
        // Check BEFORE drawing so a line never gets clipped at the bottom
        // edge — it rolls to a new page instead.
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

    doc.save(`${baseName}_extracted.pdf`);
  };

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-8 text-[#222430] dark:text-white bg-white dark:bg-transparent transition-colors">
      <div className="text-center mb-8">
        <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3 shadow-inner bg-[var(--background-secondary)] border border-[#222430]/20 dark:border-white/20 text-[#222430] dark:text-white">
          <ScanText size={28} />
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-[#222430] dark:text-white">
          OCR PDF Scanner
        </h1>
        <p className="text-[#222430]/70 dark:text-white/80 text-sm mt-1.5 max-w-lg mx-auto">
          Extract searchable text from scanned PDFs instantly using AI.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-semibold text-center transition-all">
          ⚠️ {error}
        </div>
      )}

      {!fileMeta ? (
        <UploadCard
          onFiles={handleFile}
          title={"Drag & drop a scanned PDF file here"}
          hint={"or click to browse"}
        />
      ) : (
        <>
          <div className="flex items-center gap-3 p-4 rounded-2xl border border-[#222430]/20 dark:border-white/30 bg-[var(--background-secondary)] shadow-sm text-[#222430] dark:text-white">
            <div className="w-9 h-9 rounded-xl border border-[#222430]/20 dark:border-white/30 bg-[#222430]/5 dark:bg-white/5 flex items-center justify-center shrink-0">
              <FileText size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate tracking-tight">{fileMeta.name}</p>
              <p className="text-[11px] mt-0.5 text-[#222430]/60 dark:text-white/70 font-medium">
                {fileMeta.size}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                cancel();
                setSelectedFile(null);
                setFileMeta(null);
                setExtractedText(null);
                setError(null);
              }}
              className="p-2 rounded-xl border border-[#222430]/15 dark:border-white/20 bg-[var(--background-secondary)] transition-all shrink-0 text-[#222430]/70 dark:text-white/70 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/50 hover:bg-red-500/10 shadow-sm"
              title="Remove File"
            >
              <X size={16} />
            </button>
          </div>

          {extractedText && (
            <div className="mt-6 p-4 sm:p-6 rounded-3xl border border-[#222430]/15 dark:border-white/20 shadow-md bg-[var(--background-secondary)] text-[#222430] dark:text-white transition-colors">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-3 mb-3 border-b border-[#222430]/10 dark:border-white/20">
                <div className="flex items-center gap-2">
                  <ScanText size={18} />
                  <span className="text-sm font-extrabold whitespace-nowrap">Extracted Text</span>
                </div>

                <ResultActions
                  text={extractedText}
                  onDownloadTxt={downloadAsTxt}
                  onDownloadPdf={downloadAsPdf}
                />
              </div>

              <div className="max-h-64 overflow-y-auto rounded-xl bg-[#222430]/5 dark:bg-black/20 p-4 border border-[#222430]/10 dark:border-white/10">
                <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                  {extractedText}
                </pre>
              </div>
            </div>
          )}

          <div className="mt-8 flex justify-center">
            <AiRunButton
              label={extractedText ? "Scan Again" : "Run OCR Extraction"}
              loadingLabel={extractedText ? "Rescanning..." : "Scanning Document..."}
              loading={processing}
              onClick={handleOcrScan}
            />
          </div>
        </>
      )}

      <DownloadNotice message="Extracted text downloaded." />

      <SecureNote />
    </div>
  );
}