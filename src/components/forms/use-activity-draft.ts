"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  differsFromCurrent,
  hasContent,
  parseDraft,
  type ActivityDraft,
  type DraftFields,
} from "@/shared/drafts/activity-draft";

// Yarım kalmış metnin tarayıcıda saklanması (Görev 10.2).
//
// Karar kuralları `@/shared/drafts/activity-draft` içinde ve testli; burada
// yalnız DOM okuma/yazma ve depo erişimi var.
//
// **Otomatik gönderim yok.** Metin yalnız saklanır; kaydetme kararı her zaman
// kullanıcınındır. Arka planda kendiliğinden gönderen bir sistem, kullanıcının
// yazdığını sandığı şeyle kaydedilen şeyi ayrıştırır.

/** Yazma durduktan sonra kaydetmeye kadar beklenen süre. */
const YAZMA_BEKLEMESI_MS = 500;

function depo(): Storage | null {
  try {
    // Gizli sekme ya da kapatılmış depo: özellik sessizce devre dışı kalır.
    // Bu bir iş kuralı değil, kolaylık; kullanıcıyı durdurmak orantısız olurdu.
    return window.localStorage;
  } catch {
    return null;
  }
}

function formuOku(form: HTMLFormElement): DraftFields {
  const data = new FormData(form);

  return {
    activityDate: String(data.get("activityDate") ?? ""),
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
    targetDepartmentIds: data
      .getAll("targetDepartmentIds")
      .map((deger) => String(deger)),
  };
}

function formaYaz(form: HTMLFormElement, draft: ActivityDraft): void {
  const alan = <T extends HTMLElement>(ad: string) =>
    form.elements.namedItem(ad) as T | null;

  const tarih = alan<HTMLInputElement>("activityDate");
  if (tarih) tarih.value = draft.activityDate;

  const baslik = alan<HTMLInputElement>("title");
  if (baslik) baslik.value = draft.title;

  const aciklama = alan<HTMLTextAreaElement>("description");
  if (aciklama) aciklama.value = draft.description;

}

export interface DraftControl {
  formRef: React.RefObject<HTMLFormElement | null>;
  /** Geri getirilmeyi bekleyen metin; yoksa `null`. */
  bekleyen: ActivityDraft | null;
  geriGetir: () => void;
  sil: () => void;
  /** Form gönderilirken çağrılır; mükerrer kayıt üretmemek için temizler. */
  gonderildi: () => void;
}

export function useActivityDraft(
  storageKey: string,
  current: DraftFields,
  /**
   * Departman seçimini geri yükler. Kutucuklar React durumunda tutulduğu için
   * DOM'a yazmak yetmiyor; durum güncellenmezse ekran ile forma giden değer
   * ayrışırdı.
   */
  onDepartmentsRestored: (ids: string[]) => void,
): DraftControl {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [bekleyen, setBekleyen] = useState<ActivityDraft | null>(null);
  const zamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Açılışta bakılır: saklanmış metin var mı ve formdakinden farklı mı?
  useEffect(() => {
    const store = depo();
    if (!store) return;

    const draft = parseDraft(store.getItem(storageKey));
    if (!draft) return;

    if (!hasContent(draft) || !differsFromCurrent(draft, current)) {
      store.removeItem(storageKey);
      return;
    }

    // Kural normalde haklı: efekt içinde setState zincirleme render üretir.
    // Burada **açılışta bir kez** okunan dış bir depo var ve teklifin yalnız
    // açılıştaki hâle göre verilmesi gerekiyor — kullanıcı yazmaya başlayınca
    // saklanan metin değişir ve türetilmiş bir değer şeridi yeniden açardı.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBekleyen(draft);
    // `current` bilerek bağımlılıkta değil: her render'da yeni nesne olur ve
    // efekt sonsuz döner. Açılıştaki değer yeterli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Yazdıkça saklanır.
  useEffect(() => {
    const form = formRef.current;
    const store = depo();
    if (!form || !store) return;

    const kaydet = () => {
      const alanlar = formuOku(form);

      if (!hasContent(alanlar)) {
        store.removeItem(storageKey);
        return;
      }

      store.setItem(
        storageKey,
        JSON.stringify({ ...alanlar, savedAt: new Date().toISOString() }),
      );
    };

    const zamanla = () => {
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
      zamanlayici.current = setTimeout(kaydet, YAZMA_BEKLEMESI_MS);
    };

    form.addEventListener("input", zamanla);
    form.addEventListener("change", zamanla);
    // Sekme kapanırken bekleyen kayıt varsa hemen yazılır; zamanlayıcının
    // dolmasını beklemek tam da korumak istediğimiz anı kaçırmak olurdu.
    window.addEventListener("pagehide", kaydet);

    return () => {
      form.removeEventListener("input", zamanla);
      form.removeEventListener("change", zamanla);
      window.removeEventListener("pagehide", kaydet);
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
    };
  }, [storageKey]);

  const geriGetir = useCallback(() => {
    const form = formRef.current;
    if (!form || !bekleyen) return;

    formaYaz(form, bekleyen);
    onDepartmentsRestored(bekleyen.targetDepartmentIds);
    setBekleyen(null);
  }, [bekleyen, onDepartmentsRestored]);

  const sil = useCallback(() => {
    depo()?.removeItem(storageKey);
    setBekleyen(null);
  }, [storageKey]);

  const gonderildi = useCallback(() => {
    if (zamanlayici.current) clearTimeout(zamanlayici.current);
    depo()?.removeItem(storageKey);
    setBekleyen(null);
  }, [storageKey]);

  return { formRef, bekleyen, geriGetir, sil, gonderildi };
}
