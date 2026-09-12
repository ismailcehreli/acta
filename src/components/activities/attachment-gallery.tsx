"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import {
  attachmentPreviewKind,
  type AttachmentPreviewKind,
} from "@/shared/attachments";
import { formatFileSize } from "@/shared/format/locale";

// Activity attachments (§5.2, §15.4).
export interface GalleryAttachment {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
}


function attachmentHref(id: string, inline: boolean): string {
  return inline ? `/api/attachments/${id}?inline=1` : `/api/attachments/${id}`;
}

const TYPE_LABEL_KEYS = {
  image: "common.image",
  pdf: "common.pdf",
  video: "common.video",
};

export function AttachmentGallery({
  attachments,
}: {
  attachments: GalleryAttachment[];
}) {
  const locale = useLocale();
  const t = useTranslations();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = attachments.find((attachment) => attachment.id === openId) ?? null;

  const closeOverlay = useCallback(() => setOpenId(null), []);

  if (attachments.length === 0) return null;

  const previewableAttachments = attachments.filter(
    (attachment) => attachmentPreviewKind(attachment.mimeType) !== "none",
  );
  const otherAttachments = attachments.filter(
    (attachment) => attachmentPreviewKind(attachment.mimeType) === "none",
  );

  return (
    <div className="border-t border-line pt-4" data-test="attachments">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        {t("activities.attachments")}
      </p>

      {previewableAttachments.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2.5">
          {previewableAttachments.map((attachment) => {
            const type = attachmentPreviewKind(attachment.mimeType) as Exclude<
              AttachmentPreviewKind,
              "none"
            >;

            return (
              <li key={attachment.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(attachment.id)}
                  data-test="attachment-preview"
                  data-attachment-type={type}
                  title={attachment.originalName}
                  className="group flex w-28 cursor-pointer flex-col gap-1 rounded-(--radius-sm) border border-line bg-inset/40 p-1.5 text-left transition hover:border-primary/40"
                >
                  <span className="flex h-20 w-full items-center justify-center overflow-hidden rounded-(--radius-xs) bg-inset">
                    {type === "image" ? (
                      // Attachment content comes from an authorization-controlled
                      // endpoint; Next's image optimizer would cache this address.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachmentHref(attachment.id, true)}
                        alt={attachment.originalName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-xs font-medium text-muted">
                        {t(TYPE_LABEL_KEYS[type])}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-ink">{attachment.originalName}</span>
                  <span className="text-[length:var(--text-xs)] text-muted">
                    {formatFileSize(attachment.sizeBytes, locale)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {otherAttachments.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {otherAttachments.map((attachment) => (
            <li key={attachment.id}>
              <a
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                href={attachmentHref(attachment.id, false)}
              >
                {attachment.originalName}
                <span className="text-xs text-muted">{formatFileSize(attachment.sizeBytes, locale)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? <PreviewOverlay attachment={open} onClose={closeOverlay} /> : null}
    </div>
  );
}

/**
 * Full-size preview overlay.
 *
 * Escape, clicking outside, and the close button all close it. Focus moves to
 * the overlay so keyboard users do not lose their place behind an open layer.
 */
function PreviewOverlay({
  attachment,
  onClose,
}: {
  attachment: GalleryAttachment;
  onClose: () => void;
}) {
  const t = useTranslations();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const type = attachmentPreviewKind(attachment.mimeType);
  const address = attachmentHref(attachment.id, true);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleEscape);
    closeButtonRef.current?.focus();

    // Prevent the page behind the overlay from scrolling. Without this, users
    // could scroll the page while thinking they were moving the attachment.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("activities.previewAttachment", { name: attachment.originalName })}
      data-test="attachment-preview-overlay"
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 pb-3 text-white">
        <span className="truncate text-sm font-medium">{attachment.originalName}</span>
        <span className="flex items-center gap-2">
          <a
            className="rounded-(--radius-xs) border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10"
            href={attachmentHref(attachment.id, false)}
            onClick={(event) => event.stopPropagation()}
          >
            {t("common.download")}
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            data-test="attachment-preview-close"
            className="rounded-(--radius-xs) border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10"
          >
            {t("common.close")}
          </button>
        </span>
      </div>

      {/* Clicking the content must not close the overlay: users may be pausing
          the video or scrolling the PDF. */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        {type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={address}
            alt={attachment.originalName}
            className="max-h-full max-w-full object-contain"
          />
        ) : type === "video" ? (
          <video src={address} controls autoPlay className="max-h-full max-w-full" />
        ) : (
          <iframe
            src={address}
            title={attachment.originalName}
            className="h-full w-full rounded-(--radius-sm) bg-white"
          />
        )}
      </div>
    </div>
  );
}
