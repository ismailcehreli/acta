"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Tarayıcı bildirim izni akışı (Görev 5.3b).
//
// **İzin kendiliğinden istenmez.** Sayfa açılır açılmaz izin kutusu çıkarmak,
// kullanıcının çoğunlukla "engelle" demesine yol açar ve o karar kalıcıdır —
// sonra açmak için tarayıcı ayarlarına girmek gerekir. Bu yüzden izin, ancak
// kullanıcı düğmeye bastığında isteniyor.

type Durum =
  | "yukleniyor"
  | "desteklenmiyor"
  | "kurulmamis"
  | "engellenmis"
  | "kapali"
  | "acik";

/** base64url → ArrayBuffer; tarayıcı `applicationServerKey`'i böyle istiyor. */
function anahtariCevir(base64: string): ArrayBuffer {
  const doldurma = "=".repeat((4 - (base64.length % 4)) % 4);
  const duz = (base64 + doldurma).replace(/-/g, "+").replace(/_/g, "/");
  const ham = atob(duz);
  const bayt = new Uint8Array(ham.length);
  for (let i = 0; i < ham.length; i += 1) bayt[i] = ham.charCodeAt(i);
  return bayt.buffer;
}

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [durum, setDurum] = useState<Durum>("yukleniyor");
  const [hata, setHata] = useState<string | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    let iptal = false;

    async function baslangic() {
      if (publicKey === null) {
        if (!iptal) setDurum("kurulmamis");
        return;
      }

      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!iptal) setDurum("desteklenmiyor");
        return;
      }

      if (Notification.permission === "denied") {
        if (!iptal) setDurum("engellenmis");
        return;
      }

      const kayit = await navigator.serviceWorker.getRegistration();
      const abonelik = await kayit?.pushManager.getSubscription();
      if (!iptal) setDurum(abonelik ? "acik" : "kapali");
    }

    void baslangic();
    return () => {
      iptal = true;
    };
  }, [publicKey]);

  async function ac() {
    if (publicKey === null) return;
    setCalisiyor(true);
    setHata(null);

    try {
      const izin = await Notification.requestPermission();
      if (izin !== "granted") {
        setDurum(izin === "denied" ? "engellenmis" : "kapali");
        return;
      }

      const kayit = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const abonelik = await kayit.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: anahtariCevir(publicKey),
      });

      const yanit = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(abonelik.toJSON()),
      });

      if (!yanit.ok) {
        // Sunucu kaydetmediyse tarayıcıdaki abonelik de bırakılmaz: aksi
        // hâlde kullanıcı "açık" görür ama hiç bildirim gelmez.
        await abonelik.unsubscribe();
        setHata("Abonelik sunucuya kaydedilemedi. Tekrar deneyin.");
        setDurum("kapali");
        return;
      }

      setDurum("acik");
    } catch (error) {
      setHata(error instanceof Error ? error.message : "Bildirim açılamadı.");
    } finally {
      setCalisiyor(false);
    }
  }

  async function kapat() {
    setCalisiyor(true);
    setHata(null);

    try {
      const kayit = await navigator.serviceWorker.getRegistration();
      const abonelik = await kayit?.pushManager.getSubscription();
      if (!abonelik) {
        setDurum("kapali");
        return;
      }

      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: abonelik.endpoint }),
      });
      await abonelik.unsubscribe();
      setDurum("kapali");
    } catch (error) {
      setHata(error instanceof Error ? error.message : "Bildirim kapatılamadı.");
    } finally {
      setCalisiyor(false);
    }
  }

  if (durum === "yukleniyor") {
    return <p className="text-[length:var(--text-sm)] text-muted">Kontrol ediliyor…</p>;
  }

  if (durum === "kurulmamis") {
    return (
      <Alert tone="correction">
        Tarayıcı bildirimleri henüz kurulmadı. Sistem yöneticisi{" "}
        <span className="font-medium">Sistem ayarları → Tarayıcı bildirimleri</span>{" "}
        bölümünden anahtar üretmeli.
      </Alert>
    );
  }

  if (durum === "desteklenmiyor") {
    return (
      <Alert tone="info">
        Bu tarayıcı bildirimleri desteklemiyor. iPhone&apos;da uygulamayı önce ana
        ekrana eklemeniz gerekir.
      </Alert>
    );
  }

  if (durum === "engellenmis") {
    return (
      // Testlerin bakabilmesi için işaretli: hangi dalın çıktığı tarayıcının
      // varsayılan bildirim iznine göre değişiyor, metne bakmak kırılgan.
      <div data-test="push-engellenmis">
      <Alert tone="correction">
        Bildirimler tarayıcı ayarlarından engellenmiş. Açmak için adres
        çubuğundaki kilit simgesinden izin vermeniz gerekiyor.
      </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-test="push-anahtari">
      <p className="text-[length:var(--text-sm)] text-muted">
        {durum === "acik"
          ? "Bu cihaz bildirim alıyor. Faaliyet içeriği bildirime girmez; yalnız başlık ve bağlantı gönderilir."
          : "Size soru sorulduğunda, onayınız beklendiğinde ve düzeltme istendiğinde bu cihaza bildirim gelsin."}
      </p>

      <div>
        {durum === "acik" ? (
          <Button type="button" onClick={kapat} disabled={calisiyor}>
            {calisiyor ? "Kapatılıyor…" : "Bu cihazda kapat"}
          </Button>
        ) : (
          <Button type="button" variant="primary" onClick={ac} disabled={calisiyor}>
            {calisiyor ? "Açılıyor…" : "Bu cihazda aç"}
          </Button>
        )}
      </div>

      {hata ? <Alert tone="danger">{hata}</Alert> : null}
    </div>
  );
}
