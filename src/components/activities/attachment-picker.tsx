"use client";

import { useRef, useState } from "react";

import { ALLOWED_TYPES_LABEL } from "@/shared/attachments";

export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,video/mp4,video/webm,video/quicktime";

export interface AttachmentPickerItem {
  id: string;
  originalName: string;
  sizeBytes: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Dosya seçici (§5.7). Tarayıcı aynı input'ta ikinci seçimde önceki seçimi
 * değiştirdiği için seçilen dosyalar burada tutulur ve input'un FileList'i
 * her seçimden sonra yeniden kurulur.
 */
export function AttachmentPicker({
  existingAttachments = [],
  maxCount,
  maxSizeBytes,
}: {
  existingAttachments?: AttachmentPickerItem[];
  maxCount: number;
  maxSizeBytes: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const syncInput = (files: File[]) => {
    const input = inputRef.current;
    if (!input || typeof DataTransfer === "undefined") return;

    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
  };

  const selectFiles = (picked: FileList | null) => {
    if (!picked) return;

    const kalan = Math.max(
      0,
      maxCount - existingAttachments.length - selected.length,
    );
    const files = Array.from(picked);
    const oversized = files.find((file) => file.size > maxSizeBytes);
    if (oversized) {
      setError(
        '"' +
          oversized.name +
          '" dosyası ' +
          formatSize(maxSizeBytes) +
          " sınırını aşıyor.",
      );
    } else if (files.length > kalan) {
      setError("En fazla " + maxCount + " dosya eklenebilir.");
    } else {
      setError(null);
    }

    const accepted = files
      .filter((file) => file.size <= maxSizeBytes)
      .slice(0, kalan);
    const next = [...selected, ...accepted];
    setSelected(next);
    syncInput(next);
  };

  const removeSelected = (index: number) => {
    const next = selected.filter((_, fileIndex) => fileIndex !== index);
    setSelected(next);
    setError(null);
    syncInput(next);
  };

  const total = existingAttachments.length + selected.length;
  const full = total >= maxCount;

  return (
    <div className="flex flex-col gap-2.5" data-test="ek-secici">
      <input
        ref={inputRef}
        id="files"
        name="files"
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        disabled={full}
        onChange={(event) => selectFiles(event.target.files)}
        className="block w-full text-[length:var(--text-sm)] text-muted file:mr-3 file:rounded-(--radius-sm) file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[length:var(--text-sm)] file:font-medium file:text-ink hover:file:bg-inset disabled:opacity-45"
      />

      <p data-test="ek-sayac" className="text-[length:var(--text-xs)] text-muted">
        {ALLOWED_TYPES_LABEL}. Seçim sayısı: {total}/{maxCount}. Dosya başına{" "}
        {formatSize(maxSizeBytes)}.
      </p>

      {existingAttachments.length > 0 || selected.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-[length:var(--text-sm)]"
          data-test="ek-listesi"
        >
          {existingAttachments.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-3 text-muted"
            >
              <span className="min-w-0 truncate">{file.originalName}</span>
              <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                {formatSize(file.sizeBytes)}
              </span>
            </li>
          ))}
          {selected.map((file, index) => (
            <li
              key={file.name + ":" + file.lastModified + ":" + index}
              className="flex items-center justify-between gap-3 text-ink"
            >
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="mono text-[length:var(--text-xs)] text-faint">
                  {formatSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeSelected(index)}
                  aria-label={file.name + " ekini kaldır"}
                  className="text-[length:var(--text-xs)] text-muted underline-offset-4 hover:text-danger hover:underline"
                >
                  kaldır
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? (
        <p className="text-[length:var(--text-xs)] text-muted">
          Dosya sınırına ulaşıldı. Yeni ek için seçili bir dosyayı kaldırın.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[length:var(--text-xs)] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
