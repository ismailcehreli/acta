"use client";

import { useRef, useState } from "react";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import { formatFileSize } from "@/shared/format/locale";

export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,video/mp4,video/webm,video/quicktime";

export interface AttachmentPickerItem {
  id: string;
  originalName: string;
  sizeBytes: number;
}

export function AttachmentPicker({
  existingAttachments = [],
  maxCount,
  maxSizeBytes,
}: {
  existingAttachments?: AttachmentPickerItem[];
  maxCount: number;
  maxSizeBytes: number;
}) {
  const locale = useLocale();
  const t = useTranslations();
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

    const remaining = Math.max(
      0,
      maxCount - existingAttachments.length - selected.length,
    );
    const files = Array.from(picked);
    const oversized = files.find((file) => file.size > maxSizeBytes);
    if (oversized) {
      setError(
        t("activities.attachmentTooLarge", {
          name: oversized.name,
          size: formatFileSize(maxSizeBytes, locale),
        }),
      );
    } else if (files.length > remaining) {
      setError(t("activities.attachmentCountExceeded", { count: maxCount }));
    } else {
      setError(null);
    }

    const accepted = files
      .filter((file) => file.size <= maxSizeBytes)
      .slice(0, remaining);
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
    <div className="flex flex-col gap-2.5" data-test="attachment-picker">
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

      <p data-test="attachment-count" className="text-[length:var(--text-xs)] text-muted">
        {t("activities.attachmentTypes")}. {t("activities.selectedFiles", {
          selected: total,
          max: maxCount,
        })} {t("activities.maximumPerFile", { size: formatFileSize(maxSizeBytes, locale) })}
      </p>

      {existingAttachments.length > 0 || selected.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-[length:var(--text-sm)]"
          data-test="attachment-list"
        >
          {existingAttachments.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-3 text-muted"
            >
              <span className="min-w-0 truncate">{file.originalName}</span>
              <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
                {formatFileSize(file.sizeBytes, locale)}
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
                  {formatFileSize(file.size, locale)}
                </span>
                <button
                  type="button"
                  onClick={() => removeSelected(index)}
                  aria-label={t("activities.removeAttachment") + ": " + file.name}
                  className="text-[length:var(--text-xs)] text-muted underline-offset-4 hover:text-danger hover:underline"
                >
                  {t("common.remove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? (
        <p className="text-[length:var(--text-xs)] text-muted">
          {t("activities.attachmentLimitReached")}
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
