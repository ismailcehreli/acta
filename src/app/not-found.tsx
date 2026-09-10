import { ButtonLink } from "@/components/ui/button";
import { BulunamadiIkonu, StatusPage } from "@/components/system/status-page";

// 404 yüzeyi (Görev 10.1).
//
// Metin **bilerek belirsiz**: "kayıt yok" ile "kaydı görme yetkiniz yok"
// aynı cevabı verir (§8.2, §18.4). Ayrım yapmak, görülemeyen bir kaydın
// varlığını ele verirdi.

export const metadata = { title: "Sayfa bulunamadı" };

export default function NotFound() {
  return (
    <StatusPage
      icon={<BulunamadiIkonu />}
      title="Bu sayfa yok"
      description="Aradığınız kayıt bulunamadı ya da görüntüleme yetkiniz yok. Bağlantı eski olabilir."
      marker="Bulunamadı"
      actions={<ButtonLink href="/" variant="primary">Ana ekrana dön</ButtonLink>}
    />
  );
}
