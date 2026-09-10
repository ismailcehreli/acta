"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  attachmentPreviewKind,
  type AttachmentPreviewKind,
} from "@/shared/attachments";

// Faaliyet ekleri (§5.2, §15.4).
//
// Resim, PDF ve video **sayfadan çıkmadan** açılır: küçük önizleme, tıklayınca
// aynı sayfanın üstünde büyüyen bir katman. Eskiden her ek indiriliyordu;
// bir resme bakmak için dosyayı bilgisayara indirip açmak gerekiyordu.
//
// Gösterilemeyen türler (Word, Excel) eskisi gibi indirilir — tarayıcı onları
// çizemez ve sunucuda dönüştürmek ayrı bir iştir.
//
// Katman **yeni sekme açmaz, adres değiştirmez**: kullanıcı kapattığında
// faaliyetin detayında, aynı kaydırma noktasında kalır.

export interface GalleryAttachment {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
}

/** Ek içeriğinin adresi; `inline` yalnız gösterilebilir türlerde açılır. */
function attachmentHref(id: string, inline: boolean): string {
  return inline ? `/api/attachments/${id}?inline=1` : `/api/attachments/${id}`;
}

function formatSize(sizeBytes: number): string {
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

const TUR_ETIKETI: Record<Exclude<AttachmentPreviewKind, "none">, string> = {
  image: "Resim",
  pdf: "PDF",
  video: "Video",
};

export function AttachmentGallery({
  attachments,
}: {
  attachments: GalleryAttachment[];
}) {
  const [acikId, setAcikId] = useState<string | null>(null);
  const acik = attachments.find((ek) => ek.id === acikId) ?? null;

  const kapat = useCallback(() => setAcikId(null), []);

  if (attachments.length === 0) return null;

  const gosterilebilirler = attachments.filter(
    (ek) => attachmentPreviewKind(ek.mimeType) !== "none",
  );
  const digerleri = attachments.filter(
    (ek) => attachmentPreviewKind(ek.mimeType) === "none",
  );

  return (
    <div className="border-t border-line pt-4" data-test="ekler">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">Ekler</p>

      {gosterilebilirler.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2.5">
          {gosterilebilirler.map((ek) => {
            const tur = attachmentPreviewKind(ek.mimeType) as Exclude<
              AttachmentPreviewKind,
              "none"
            >;

            return (
              <li key={ek.id}>
                <button
                  type="button"
                  onClick={() => setAcikId(ek.id)}
                  data-test="ek-onizleme"
                  data-ek-turu={tur}
                  title={ek.originalName}
                  className="group flex w-28 cursor-pointer flex-col gap-1 rounded-(--radius-sm) border border-line bg-inset/40 p-1.5 text-left transition hover:border-primary/40"
                >
                  <span className="flex h-20 w-full items-center justify-center overflow-hidden rounded-(--radius-xs) bg-inset">
                    {tur === "image" ? (
                      // Ek içeriği yetkiye bağlı bir uçtan geliyor; Next'in
                      // resim iyileştirmesi bu adresi önbelleğe alırdı.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachmentHref(ek.id, true)}
                        alt={ek.originalName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-xs font-medium text-muted">
                        {TUR_ETIKETI[tur]}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-ink">{ek.originalName}</span>
                  <span className="text-[length:var(--text-xs)] text-muted">
                    {formatSize(ek.sizeBytes)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {digerleri.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {digerleri.map((ek) => (
            <li key={ek.id}>
              <a
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                href={attachmentHref(ek.id, false)}
              >
                {ek.originalName}
                <span className="text-xs text-muted">{formatSize(ek.sizeBytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {acik ? <Onizleme ek={acik} onKapat={kapat} /> : null}
    </div>
  );
}

/**
 * Büyütülmüş gösterim katmanı.
 *
 * Esc, dışına tıklama ve kapat düğmesi — üçü de kapatır. Odak katmana
 * alınıyor: klavyeyle gezen kullanıcı, katman açıkken arkadaki sayfada
 * kaybolmamalı.
 */
function Onizleme({
  ek,
  onKapat,
}: {
  ek: GalleryAttachment;
  onKapat: () => void;
}) {
  const kapatDugmesi = useRef<HTMLButtonElement>(null);
  const tur = attachmentPreviewKind(ek.mimeType);
  const adres = attachmentHref(ek.id, true);

  useEffect(() => {
    function escBasildi(event: KeyboardEvent) {
      if (event.key === "Escape") onKapat();
    }

    document.addEventListener("keydown", escBasildi);
    kapatDugmesi.current?.focus();

    // Katman açıkken arkadaki sayfa kaymasın: kullanıcı resmi kaydırdığını
    // sanarken sayfayı kaydırıyor ve kapattığında başka bir yerde buluyordu.
    const oncekiTasma = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", escBasildi);
      document.body.style.overflow = oncekiTasma;
    };
  }, [onKapat]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${ek.originalName} önizleme`}
      data-test="ek-onizleme-katmani"
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4 backdrop-blur-sm"
      onClick={onKapat}
    >
      <div className="flex items-center justify-between gap-4 pb-3 text-white">
        <span className="truncate text-sm font-medium">{ek.originalName}</span>
        <span className="flex items-center gap-2">
          <a
            className="rounded-(--radius-xs) border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10"
            href={attachmentHref(ek.id, false)}
            onClick={(event) => event.stopPropagation()}
          >
            İndir
          </a>
          <button
            ref={kapatDugmesi}
            type="button"
            onClick={onKapat}
            data-test="ek-onizleme-kapat"
            className="rounded-(--radius-xs) border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10"
          >
            Kapat
          </button>
        </span>
      </div>

      {/* İçeriğe tıklamak katmanı kapatmamalı: kullanıcı videoyu duraklatmak
          ya da PDF'i kaydırmak için tıklıyor olabilir. */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        {tur === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={adres}
            alt={ek.originalName}
            className="max-h-full max-w-full object-contain"
          />
        ) : tur === "video" ? (
          <video src={adres} controls autoPlay className="max-h-full max-w-full" />
        ) : (
          <iframe
            src={adres}
            title={ek.originalName}
            className="h-full w-full rounded-(--radius-sm) bg-white"
          />
        )}
      </div>
    </div>
  );
}
