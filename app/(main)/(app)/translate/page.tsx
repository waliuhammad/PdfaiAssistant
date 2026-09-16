"use client";

import { useState } from "react";
import { DownloadNotice } from "@/components/download-notice";
import { SecureNote, UploadCard } from "@/components/tools/upload-card";
import { AiRunButton } from "@/components/tools/ai-run-button";
import { FeatureLockNotice, useFeatureLock } from "@/components/tools/feature-lock";
import { ResultActions } from "@/components/tools/result-actions";
import { downloadBlob } from "@/lib/download";
import { Languages, Sparkles, FileText, X } from "lucide-react";
import LanguageSelect from "@/components/language-select";
import { errorMessage } from "@/lib/errors";
import { useCancellableRun, wasCancelled } from "@/hooks/useCancellableRun";

export default function PdfTranslatorPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { begin, cancel } = useCancellableRun();
  const { locked } = useFeatureLock("translate");
  const [fileMeta, setFileMeta] = useState<{ name: string; size: string } | null>(null);
  const [targetLang, setTargetLang] = useState("Spanish");

  const [translatedText, setTranslatedText] = useState<string | null>(null);
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
    setTranslatedText(null);
  };

  const handleTranslate = async (e: React.FormEvent) => {
    const signal = begin();
    e.preventDefault();
    if (!selectedFile || loading) return;

    setLoading(true);
    setError(null);
    setTranslatedText(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("language", targetLang);

      const res = await fetch("/api/translate", {
        method: "POST",
        body: formData, signal
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to translate the document.");
      }

      // Adjust based on your Python backend's exact response key
      const result = data.result.translatedText;

      setTranslatedText(result);
    } catch (err) {
      if (wasCancelled(err, signal)) return;
      setError(errorMessage(err, "Something went wrong connecting to the server."));
    } finally {
      setLoading(false);
    }
  };

  // Base filename (without extension), plus target language, so repeat
  // translations of the same doc don't collide, e.g. "report_translated_Spanish.pdf".
  const baseName = (fileMeta?.name || "document").replace(/\.pdf$/i, "");
  const downloadName = `${baseName}_translated_${targetLang}`;

  const downloadAsTxt = () => {
    if (!translatedText) return;
    const blob = new Blob([translatedText], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${downloadName}.txt`);
  };

  const downloadAsPdf = async () => {
    if (!translatedText) return;
    // Loaded on demand so it doesn't add weight until someone actually
    // exports a PDF.
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();

    const marginX = 15;
    const marginY = 20;
    const maxWidth = 180;
    const lineHeight = 7;
    const pageBottom = 280;

    let cursorY = marginY;
    doc.setFontSize(11);

    // Same fix as the OCR page: draw line-by-line and paginate manually,
    // since a single doc.text(lines, x, y) call never adds new pages on
    // its own — that was silently truncating long translations to page 1.
    const lines: string[] = doc.splitTextToSize(translatedText, maxWidth);
    lines.forEach((line) => {
      if (cursorY > pageBottom) {
        doc.addPage();
        cursorY = marginY;
      }
      doc.text(line, marginX, cursorY);
      cursorY += lineHeight;
    });

    doc.save(`${downloadName}.pdf`);
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8 text-[#222430] dark:text-white bg-white dark:bg-transparent transition-colors">
      <div className="text-center mb-8">
        <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3 shadow-inner bg-[var(--background-secondary)] border border-[#222430]/20 dark:border-white/20 text-[#222430] dark:text-white">
          <Languages size={28} />
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-[#222430] dark:text-white">
          AI PDF Translator
        </h1>
        <p className="text-[#222430]/70 dark:text-white/80 text-sm mt-1.5 max-w-lg mx-auto">
          Upload a PDF document to translate its contents into your desired language.
        </p>
      </div>

      {locked && (
        <div className="mb-6">
          <FeatureLockNotice />
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-semibold text-center transition-all">
          ⚠️ {error}
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
        <form onSubmit={handleTranslate} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Upload & Config Panel */}
          <div className="flex flex-col rounded-3xl border border-[#222430]/15 dark:border-white/20 shadow-md bg-[var(--background-secondary)] text-[#222430] dark:text-white p-5 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-[#222430]/70 dark:text-white">
                Upload Document
              </label>
              <LanguageSelect value={targetLang} onChange={setTargetLang} />
            </div>

            <div className="flex-1 flex flex-col justify-between">
              <div className="flex items-center gap-3 p-3 rounded-2xl border border-[#222430]/20 dark:border-white/30 bg-[#222430]/5 dark:bg-white/5">
                <div className="w-9 h-9 rounded-xl border border-[#222430]/20 dark:border-white/30 bg-[#222430]/5 dark:bg-white/5 flex items-center justify-center shrink-0">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate tracking-tight">{fileMeta.name}</p>
                  <p className="text-[11px] mt-0.5 text-[#222430]/60 dark:text-white/70 font-medium">
                    {fileMeta.size}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { cancel(); setSelectedFile(null); setFileMeta(null); setTranslatedText(null); setError(null); }}
                  className="p-2 rounded-xl border border-[#222430]/15 dark:border-white/20 bg-[var(--background-secondary)] transition-all shrink-0 text-[#222430]/70 dark:text-white/70 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/50 hover:bg-red-500/10 shadow-sm"
                  title="Remove File"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-4 text-center text-xs text-[#222430]/60 dark:text-white/70 font-medium">
                Ready to translate into {targetLang}.
              </div>
            </div>

            <div className="pt-3 border-t border-[#222430]/10 dark:border-white/20 mt-3 flex justify-end">
              <AiRunButton
                type="submit"
                label="Translate PDF"
                loadingLabel="Translating..."
                loading={loading}
                disabled={!selectedFile || locked}
              />
            </div>
          </div>

          {/* Output Panel */}
          <div className="flex flex-col rounded-3xl border border-[#222430]/15 dark:border-white/20 shadow-md bg-[var(--background-secondary)] text-[#222430] dark:text-white p-5 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#222430]/70 dark:text-white flex items-center gap-1.5">
                <Sparkles size={13} />
                Translated Result
              </span>
              {translatedText && (
                <ResultActions
                  text={translatedText}
                  onDownloadTxt={downloadAsTxt}
                  onDownloadPdf={downloadAsPdf}
                />
              )}
            </div>
            <div className="w-full flex-1 rounded-xl bg-[#222430]/5 dark:bg-black/20 p-4 border border-[#222430]/10 dark:border-white/10 overflow-y-auto max-h-[300px]">
              {translatedText ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {translatedText}
                </p>
              ) : (
                <div className="h-full flex items-center justify-center text-center text-[#222430]/60 dark:text-white/70 text-xs font-medium">
                  Translation output will appear here...
                </div>
              )}
            </div>
            <div className="pt-3 border-t border-[#222430]/10 dark:border-white/20 mt-3 flex justify-end">
              <span className="text-xs text-[#222430]/60 dark:text-white/70 font-medium">Powered by AI</span>
            </div>
          </div>
        </form>
      )}

      <DownloadNotice message="Translation downloaded." />

      <SecureNote />
    </div>
  );
}