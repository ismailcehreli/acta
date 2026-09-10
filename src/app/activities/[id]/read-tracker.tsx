"use client";

import { useEffect, useRef } from "react";

import { markReadAction } from "./read-actions";

/**
 * "Okundu" ölçümü (§10.2): detay görünümü açıldıktan sonra sistem ayarındaki
 * süre boyunca **görünür durumda** kalırsa kayıt düşer. Sayfa daha önce kapanırsa ya da
 * sekme arka plana alınırsa sayaç sıfırlanır — arka plandaki sekme okuma
 * sayılmaz (denetim 18.08.2026, FAZ 4 bulgu 8).
 *
 * Sunucuya süre gönderilmez; imzalı bilet gönderilir ve süreyi sunucu ölçer.
 * Buradaki sayaç yalnızca "ne zaman haber vereyim" sorusunu cevaplar.
 *
 * Manuel "okudum" butonu yoktur (İlke 4): ölçüm otomatiktir.
 *
 * **İlk bilet saklanır ve sonraki biletler yok sayılır.** Süreyi sunucu
 * biletin düzenlenme anından ölçüyor; sayfa her tazelendiğinde yeni bir bilet
 * üretiliyor ve ölçüm baştan başlıyor. Gerçek zamanlı tazeleme (Görev 7.3)
 * devreye girince okuma hiç kaydedilmez oldu — uçtan uca okundu testi bunu
 * yakaladı. Doğru olan da bu: ölçülmek istenen "kullanıcı bu ekranı ne zaman
 * açtı", "en son ne zaman tazelendi" değil.
 */
export function ReadTracker({
  activityId,
  ticket,
  dwellMs,
}: {
  activityId: string;
  ticket: string;
  dwellMs: number;
}) {
  // Bilerek güncellenmiyor: ilk biletin damgası okumanın başlangıcıdır.
  const ilkBilet = useRef(ticket);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let bildirildi = false;

    function durdur() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    function basla() {
      if (bildirildi || timer !== undefined) return;
      timer = setTimeout(() => {
        bildirildi = true;
        void markReadAction(activityId, ilkBilet.current).catch((error: unknown) => {
          console.error("Faaliyet okuma kaydı gönderilemedi.", error);
        });
      }, dwellMs);
    }

    function gorunurlukDegisti() {
      if (document.visibilityState === "visible") basla();
      else durdur();
    }

    gorunurlukDegisti();
    document.addEventListener("visibilitychange", gorunurlukDegisti);
    window.addEventListener("blur", durdur);
    window.addEventListener("focus", basla);

    return () => {
      durdur();
      document.removeEventListener("visibilitychange", gorunurlukDegisti);
      window.removeEventListener("blur", durdur);
      window.removeEventListener("focus", basla);
    };
    // Bilet bilerek dışarıda; bkz. yukarıdaki açıklama.
  }, [activityId, dwellMs]);

  return null;
}
