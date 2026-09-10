"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// Gerçek zamanlı tazeleme (§13, Görev 7.3).
//
// Akıştan gelen haber içerik taşımaz; bu bileşen yalnızca sayfayı tazeler ve
// içerik **her zamanki görünürlük denetiminden** geçerek gelir.

/**
 * Tazeleme kullanıcının yazdığı metni silebilir: sunucu bileşenleri yeniden
 * üretildiğinde formdaki denetimsiz alanlar sıfırlanır. Bu yüzden odak bir
 * form alanındayken tazeleme **ertelenir** ve odak çıkınca yapılır. Cevap
 * yazarken metnin uçması, gerçek zamanlılığın getirdiğinden çok daha büyük
 * bir kayıptır.
 */
function formAlanindaMi(): boolean {
  const etkin = document.activeElement;
  if (!etkin) return false;

  const etiket = etkin.tagName;
  return (
    etiket === "INPUT" ||
    etiket === "TEXTAREA" ||
    etiket === "SELECT" ||
    (etkin as HTMLElement).isContentEditable === true
  );
}

/** Arka arkaya gelen olaylar tek tazelemede toplanır. */
const TOPLAMA_MS = 300;

export function LiveRefresh() {
  const router = useRouter();
  // Etkiler arasında paylaşılan durum; yeniden render tetiklemesin diye ref.
  const bekleyen = useRef(false);
  const zamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Yönlendirici bir **ref**'te tutulur ve efektin bağımlılığı boştur.
   *
   * `useRouter()` her tazelemeden sonra yeni bir nesne döndürüyor. Bağımlılık
   * listesine konduğunda efekt yeniden koşuyor, akış kapanıp yeniden açılıyor,
   * açılıştaki `reconnected` işareti yeni bir tazeleme tetikliyordu — sayfa
   * hiç durulmuyordu. Uçtan uca test bunu ilk koşuda yakaladı (Görev 7.3).
   */
  const routerRef = useRef(router);

  // Ref yalnızca efektte güncellenir: render sırasında ref yazmak React'in
  // kurallarına aykırı ve derleyici bunu hata sayıyor.
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const tazele = () => {
      if (formAlanindaMi()) {
        // Odak çıkınca `focusout` dinleyicisi devralır.
        bekleyen.current = true;
        return;
      }

      bekleyen.current = false;
      routerRef.current.refresh();
    };

    const zamanla = () => {
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
      zamanlayici.current = setTimeout(tazele, TOPLAMA_MS);
    };

    const odakCikti = () => {
      if (!bekleyen.current) return;
      // Odak bir alandan diğerine geçiyor olabilir; bir tur beklenir.
      setTimeout(() => {
        if (bekleyen.current && !formAlanindaMi()) tazele();
      }, 0);
    };

    const source = new EventSource("/api/events");
    source.onmessage = zamanla;
    // Adlandırılmış olaylar `onmessage`'a düşmez; her tür için ayrı bağlanır.
    for (const tur of [
      "activity_created",
      "question_asked",
      "answer_received",
      "conversation_closed",
      "activity_cancelled",
      "approval_pending",
      "approval_decided",
      "reconnected",
    ]) {
      source.addEventListener(tur, zamanla);
    }

    // Hata durumunda tarayıcı `retry` aralığıyla kendisi yeniden bağlanır;
    // burada kapatmak o mekanizmayı devre dışı bırakırdı.
    document.addEventListener("focusout", odakCikti);

    return () => {
      document.removeEventListener("focusout", odakCikti);
      if (zamanlayici.current) clearTimeout(zamanlayici.current);
      source.close();
    };
    // Akış bileşenin ömrü boyunca **bir kez** kurulur; bkz. `routerRef`.
  }, []);

  return null;
}
