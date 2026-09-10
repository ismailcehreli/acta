"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/button";

import { StatusPage, UyariIkonu } from "@/components/system/status-page";

// Beklenmeyen hata yüzeyi (Görev 10.1).
//
// **Hata metni kullanıcıya gösterilmez.** Sunucu hatası mesajı tablo adı,
// sorgu parçası ya da başka birinin verisini taşıyabilir. Kullanıcıya
// gösterilen tek teknik bilgi Next'in ürettiği `digest` — sunucu günlüğünde
// aynı numarayla hatanın tamamı duruyor. Destek "hangi hata" diye sorduğunda
// kullanıcının okuyabileceği tek şey bu olmalı.
//
// `reset()` sayfayı yeniden çizmeyi dener. Geçici bir arıza (bağlantı kopması,
// kilit çakışması) için sayfayı elle yenilemekten daha ucuz.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Tarayıcı konsoluna yazılır; sunucu tarafı zaten kendi günlüğüne yazdı.
    console.error("[hata]", error.digest ?? "", error.message);
  }, [error]);

  return (
    <StatusPage
      icon={<UyariIkonu />}
      title="Beklenmeyen bir hata oluştu"
      description="Bu sayfa açılamadı. Kaydettiğiniz bir işlem varsa tamamlanmış olabilir; tekrar denemeden önce listeyi kontrol edin."
      detail={error.digest ? `Hata kodu: ${error.digest}` : undefined}
      marker="Hata"
      tone="danger"
      actions={
        <>
          <Button type="button" variant="primary" onClick={reset}>
            Tekrar dene
          </Button>
          <ButtonLink href="/" variant="secondary">
            Ana ekrana dön
          </ButtonLink>
        </>
      }
    />
  );
}
