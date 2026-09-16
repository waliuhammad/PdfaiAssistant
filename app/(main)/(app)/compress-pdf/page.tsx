"use client";

import React, { useState } from "react";
import { DownloadNotice } from "@/components/download-notice";
import { FileText, X, FileArchive, Download, Loader2, CheckCircle2, ChevronDown } from "lucide-react";
import { SecureNote, UploadCard } from "@/components/tools/upload-card";
// aliased: this component already has state called errorMessage, which would
// shadow the import and turn the call below into calling a string.
import { errorMessage as messageFrom } from "@/lib/errors";
import { downloadBlob } from "@/lib/download";
import { useCancellableRun, wasCancelled } from "@/hooks/useCancellableRun";

interface TargetOption {
  label: string;
  targetKB: number;
  ratio: number;
}

export default function CompressPdfPage() {
  const [rawFile, setRawFile] = useState<File | null>(null);
  const { begin, cancel } = useCancellableRun();
  const [fileDetails, setFileDetails] = useState<{ name: string; size: number; formattedSize: string } | null>(null);
  const [options, setOptions] = useState<TargetOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<TargetOption | null>(null);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [compressedSize, setCompressedSize] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * The finished file, held until the reader asks for it.
   *
   * Compressing used to download the result the instant it arrived, so the
   * saving was reported after the file had already been written to disk —
   * there was no way to see "reduced to 1.2 MB, -45%" and decide against it.
   * Keeping the blob here separates the two: compress, look, then download.
   *
   * It also fixes what the Download button did. It was wired to
   * executeCompress, so it re-uploaded and re-compressed the same PDF for a
   * file the browser was already holding — a second round trip, and a second
   * operation off the daily allowance, to produce bytes that already existed.
   */
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const generateOptions = (fileSizeBytes: number): TargetOption[] => {
    const fileSizeKB = fileSizeBytes / 1024;

    const levels = [
      { label: "Extreme — smallest file, visibly softer images", ratio: 0.25 },
      { label: "High — much smaller, some loss of detail", ratio: 0.40 },
      { label: "Medium — smaller, detail mostly kept", ratio: 0.55 },
      { label: "Recommended — a good balance for sharing", ratio: 0.70 },
      { label: "Low — gentle, hard to tell apart", ratio: 0.85 },
      { label: "Minimal — safest, trims excess resolution only", ratio: 0.95 },
    ];

    return levels.map((level) => ({
      label: level.label,
      // Still sent, so a future size-targeted mode has something to aim at.
      targetKB: Math.round(fileSizeKB * level.ratio),
      ratio: level.ratio,
    }));
  };

  const handleFile = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    if (f.type !== "application/pdf") {
      setErrorMessage("Please select a valid PDF file.");
      return;
    }

    const fileOptions = generateOptions(f.size);

    setRawFile(f);
    setFileDetails({
      name: f.name,
      size: f.size,
      formattedSize: formatSize(f.size),
    });
    setOptions(fileOptions);
    setSelectedOption(fileOptions[2]); // Default to Medium Compression
    setDone(false);
    setCompressedSize(null);
    setCompressedBlob(null);
    setErrorMessage(null);
  };

  const executeCompress = async () => {
    const signal = begin();
    if (!rawFile || !selectedOption) return;
    setProcessing(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", rawFile);
      formData.append("targetSizeKB", String(selectedOption.targetKB));
      formData.append("targetRatio", String(selectedOption.ratio));

      const response = await fetch("/api/compress-pdf", {
        method: "POST",
        body: formData, signal });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to compress PDF.");
      }

      const blob = await response.blob();
      setCompressedSize(blob.size);
      setCompressedBlob(blob);

      setDone(true);
    } catch (err) {
      if (wasCancelled(err, signal)) return;
      setErrorMessage(messageFrom(err, "An error occurred while connecting to the server."));
    } finally {
      setProcessing(false);
    }
  };

  /** Hands over the file already in memory — no second trip to the server. */
  const handleDownload = () => {
    if (!compressedBlob || !rawFile) return;
    downloadBlob(compressedBlob, `compressed_${rawFile.name}`);
  };

  const calculateSavings = () => {
    if (!fileDetails || !compressedSize) return 0;
    const diff = fileDetails.size - compressedSize;
    if (diff <= 0) return 0;
    return Math.round((diff / fileDetails.size) * 100);
  };

  return (
    <div className="max-w-5xl mx-auto w-full px-4 sm:px-6">
      <div className="text-center mb-6 sm:mb-8">
        <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto rounded-2xl bg-card border border-card flex items-center justify-center mb-3 text-fg">
          <FileArchive size={24} className="sm:hidden" />
          <FileArchive size={28} className="hidden sm:block" />
        </div>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-fg tracking-tight">Compress PDF</h1>
        <p className="text-slate-600 dark:text-[#9ca3af] text-xs sm:text-sm mt-1.5 max-w-lg mx-auto px-2">
          Choose how hard to compress, then download. Text stays sharp — it is the images that shrink.
        </p>
      </div>

      {!fileDetails ? (
        <UploadCard
          onFiles={handleFile}
          title="Click to browse or drag & drop PDFs"
          hint="Upload a document to start compression"
        />
      ) : (
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-card border border-card rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-card border border-card flex items-center justify-center shrink-0 text-fg">
                <FileText size={18} className="sm:hidden" />
                <FileText size={20} className="hidden sm:block" />
              </div>
              <div className="min-w-0">
                <p className="text-fg text-sm font-bold truncate">{fileDetails.name}</p>
                <p className="text-xs text-slate-600 dark:text-[#9ca3af] mt-0.5">
                  Original Size: <strong className="text-fg">{fileDetails.formattedSize}</strong>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                // Removing the file stops whatever it was being used for.
                cancel();
                setFileDetails(null);
                setRawFile(null);
                setDone(false);
                setCompressedSize(null);
                setCompressedBlob(null);
                setErrorMessage(null);
              }}
              className="w-full sm:w-auto py-1.5 px-3.5 rounded-xl border border-card bg-[var(--background-secondary)] hover:bg-card text-slate-600 dark:text-[#9ca3af] hover:text-fg font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shrink-0"
            >
              <X size={15} className="text-red-500 dark:text-red-400" /> Remove File
            </button>
          </div>

          <div className="bg-card border border-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-md space-y-5 sm:space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-card">
              <div className="flex items-center gap-2">
                <FileArchive size={16} className="text-fg sm:hidden" />
                <FileArchive size={18} className="text-fg hidden sm:block" />
                <span className="text-xs sm:text-sm font-extrabold text-fg">Compression Configuration</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wider font-semibold text-slate-600 dark:text-[#9ca3af] block mb-1.5">
                  Select Compression Level
                </label>
                {/* The chevron is ours rather than the browser's. Chrome anchors
                    the native one to the border box and ignores padding-right,
                    so it sat hard against the rounded corner and no amount of
                    padding moved it — appearance-none is the only way to give
                    it room. pr-9 keeps the option text from running underneath. */}
                <div className="relative">
                  {/* Identified by the level, never by the target size. The size is
                      the file's size times the level, rounded to a whole KB, so
                      on a small file several levels land on the same number —
                      and the first match won, meaning a person who chose Medium
                      was quietly compressed at Extreme. */}
                  <select
                    value={selectedOption?.ratio ?? ""}
                    onChange={(e) => {
                      const opt = options.find((o) => o.ratio === Number(e.target.value));
                      if (opt) setSelectedOption(opt);
                      setDone(false);
                      setErrorMessage(null);
                    }}
                    className="w-full max-w-full appearance-none bg-card border border-card rounded-xl pl-3 sm:pl-3.5 pr-9 sm:pr-10 py-2.5 sm:py-3 text-fg text-xs sm:text-sm focus:outline-none focus:border-slate-900 dark:border-white cursor-pointer"
                  >
                    {options.map((opt) => (
                      <option key={opt.ratio} value={opt.ratio} className="bg-card text-fg">
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* pointer-events-none so the whole control still opens the
                      menu, including the arrow itself. */}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 sm:right-3.5 top-1/2 -translate-y-1/2 text-muted"
                  />
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-950/50 border border-red-800 text-red-400 text-xs font-semibold text-center">
                {errorMessage}
              </div>
            )}

            <div className="pt-1 sm:pt-2">
              {!done ? (
                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      // Removing the file stops whatever it was being used for.
                      cancel();
                      setFileDetails(null);
                      setRawFile(null);
                      setDone(false);
                      setCompressedSize(null);
                      setCompressedBlob(null);
                      setErrorMessage(null);
                    }}
                    className="w-full sm:w-auto shrink-0 py-2.5 sm:py-3 px-5 sm:px-6 rounded-2xl border border-card text-slate-600 dark:text-[#9ca3af] hover:text-slate-900 dark:hover:text-fg font-bold text-xs transition-colors"
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    onClick={executeCompress}
                    disabled={processing}
                    className="w-full sm:flex-1 py-3 sm:py-3.5 rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-zinc-900 font-bold text-xs sm:text-sm shadow-lg disabled:opacity-60 flex items-center justify-center gap-2.5 transition-all hover:bg-slate-800 dark:hover:bg-zinc-200"
                  >
                    {processing ? <Loader2 className="animate-spin" size={18} /> : <FileArchive size={18} />}
                    {processing ? "Compressing PDF..." : "Compress PDF"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  {/* emerald-400 had no light variant, so the success line was
                      washed out on a white background. Same pair the other
                      tools use. */}
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-extrabold text-xs sm:text-sm">
                    <CheckCircle2 size={18} />
                    <span>PDF Compressed Successfully!</span>
                  </div>

                  {compressedSize && (
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-[#9ca3af]">
                      Size reduced from <strong className="text-fg">{fileDetails.formattedSize}</strong> to{" "}
                      <strong className="text-fg">{formatSize(compressedSize)}</strong>
                      {calculateSavings() > 0 && (
                        // The savings pill was styled for dark only: a near-black
                        // green fill in light mode, where the surrounding card is
                        // white.
                        <span className="ml-2 sm:ml-2.5 px-2 sm:px-2.5 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800 font-bold inline-block">
                          -{calculateSavings()}%
                        </span>
                      )}
                    </p>
                  )}

                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDone(false);
                        setCompressedBlob(null);
                        setCompressedSize(null);
                      }}
                      className="w-full sm:w-auto shrink-0 py-2.5 sm:py-3 px-5 sm:px-6 rounded-2xl border border-card text-slate-600 dark:text-[#9ca3af] hover:text-slate-900 dark:hover:text-fg font-bold text-xs transition-colors"
                    >
                      Compress Again
                    </button>
                    {/* Downloads what is already in memory. It used to call
                        executeCompress, which compressed the file a second time
                        and spent another operation to get the same bytes back. */}
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={!compressedBlob}
                      className="w-full sm:flex-1 py-3 sm:py-3.5 rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-zinc-900 font-bold text-xs sm:text-sm shadow-lg disabled:opacity-60 flex items-center justify-center gap-2.5 transition-all hover:bg-slate-800 dark:hover:bg-zinc-200"
                    >
                      <Download size={18} />
                      Download Compressed PDF
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <DownloadNotice message="Document compressed and downloaded." />

      <SecureNote />
    </div>
  );
}