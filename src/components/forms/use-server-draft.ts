"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveDraftAction } from "@/app/drafts/actions";
import { emptyDraftState } from "@/app/drafts/form-state";

// Faaliyet taslağının **sunucuya** otomatik kaydedilmesi (21.08.2026).
//
// Tarayıcıdaki yarım kalan metin (`use-activity-draft`) yerini almaz, üstüne
// biner. İkisi farklı sorunu çözüyor:
//
//   · Yerel depo — aynı sekmede, ağ olmasa bile, anında. Sayfa yenilenince
//     "yarım kalan metniniz var" der.
//   · Sunucu taslağı — kalıcı ve **her cihazdan görünür**. Bilgisayar kapansa,
//     tarayıcı verisi silinse bile Taslaklar sayfasında durur.
//
// **Otomatik gönderim yok.** Taslak kaydedilir; faaliyet olarak gönderme
// kararı her zaman kullanıcınındır.
//
// Yazma durdukça kaydedilir, her tuşta değil: her tuşta sunucuya gitmek hem
// gereksiz hem de yazarken takılma hissi yaratır.

const BEKLEME_MS = 2000;

export type ServerDraftDurum = "bos" | "kaydediliyor" | "kaydedildi" | "hata";

export function useServerDraft(
  formRef: React.RefObject<HTMLFormElement | null>,
  /** Var olan taslak düzenleniyorsa kimliği. */
  initialDraftId: string | null,
  /** Kapalıysa hiç kaydedilmez (düzeltme ekranında taslak anlamsız). */
  enabled: boolean,
) {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [durum, setDurum] = useState<ServerDraftDurum>("bos");
  const [kayitAni, setKayitAni] = useState<Date | null>(null);

  const zamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sonGonderilen = useRef<string>("");
  const durduruldu = useRef(false);
  const draftIdRef = useRef<string | null>(initialDraftId);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const kaydet = useCallback(async () => {
    const form = formRef.current;
    if (!form || durduruldu.current) return;

    const data = new FormData(form);
    const baslik = String(data.get("title") ?? "").trim();
    const aciklama = String(data.get("description") ?? "").trim();
    const files = data
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    // Bomboş form saklanmaz: Taslaklar listesi çöple dolar.
    if (baslik === "" && aciklama === "") return;

    // Değişmemiş metin ikinci kez gönderilmez.
    const imza = JSON.stringify([
      data.get("activityDate"),
      baslik,
      aciklama,
      data.getAll("targetDepartmentIds"),
      files.map((file) => [file.name, file.size, file.lastModified]),
    ]);
    if (imza === sonGonderilen.current) return;

    const gonderilecek = new FormData();
    gonderilecek.set("draftId", draftIdRef.current ?? "");
    gonderilecek.set("activityDate", String(data.get("activityDate") ?? ""));
    gonderilecek.set("title", String(data.get("title") ?? ""));
    gonderilecek.set("description", String(data.get("description") ?? ""));
    for (const id of data.getAll("targetDepartmentIds")) {
      gonderilecek.append("targetDepartmentIds", String(id));
    }
    if (data.get("openFollowUp") === "on") gonderilecek.set("openFollowUp", "on");
    for (const file of files) gonderilecek.append("files", file);
    // Otomatik kaydetme; kullanıcının bilinçli kararı değil.
    gonderilecek.set("savedManually", "0");

    setDurum("kaydediliyor");

    try {
      const sonuc = await saveDraftAction(emptyDraftState, gonderilecek);

      if (durduruldu.current) return;

      if (sonuc.error) {
        // Sessiz başarısızlık yok: kullanıcı taslağının kaydedilmediğini
        // bilmeli, yoksa güvendiği bir ağ olmadan yazmaya devam eder.
        setDurum("hata");
        return;
      }

      sonGonderilen.current = imza;
      if (sonuc.draftId) setDraftId(sonuc.draftId);
      setKayitAni(new Date());
      setDurum("kaydedildi");
    } catch {
      if (!durduruldu.current) setDurum("hata");
    }
  }, [formRef]);

  useEffect(() => {
    if (!enabled) return;

    const form = formRef.current;
    if (!form) return;

    const zamanla = () => {
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
      zamanlayici.current = setTimeout(() => void kaydet(), BEKLEME_MS);
    };

    form.addEventListener("input", zamanla);
    form.addEventListener("change", zamanla);

    return () => {
      form.removeEventListener("input", zamanla);
      form.removeEventListener("change", zamanla);
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
    };
  }, [enabled, formRef, kaydet]);

  /**
   * Faaliyet gönderiliyor: bekleyen otomatik kaydetme iptal edilir ve bir
   * daha kaydedilmez. Gönderimden sonra kaydedilen bir taslak, gönderilmiş
   * kaydın kopyası olarak listede kalırdı.
   */
  const gonderiliyor = useCallback(() => {
    durduruldu.current = true;
    if (zamanlayici.current) clearTimeout(zamanlayici.current);
  }, []);

  return { draftId, durum, kayitAni, gonderiliyor };
}
