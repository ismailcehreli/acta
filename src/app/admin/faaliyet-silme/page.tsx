import { redirect } from "next/navigation";

import { AdminNav } from "@/components/shell/admin-nav";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { describeActivityForDeletion } from "@/server/activities/delete";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { formatDay } from "@/shared/format/date-time";

import { FaaliyetArama, SilmeAdimlari } from "./silme-formu";

// Faaliyet silme (ürün sahibi kararı, 03.09.2026; açık soru 25).
//
// Ekran **yalnız üst veri** gösterir: yazar, birim, tarih, başlık, durum.
// Açıklama metni burada yoktur ve olmayacaktır — sistem yöneticisinin işlevsel
// yetkisi içerik erişimi vermez (§15.1). Root ne sildiğini bilir, ne yazdığını
// okumaz.

export const metadata = { title: "Faaliyet silme" };

const DURUM_ETIKETI: Record<string, string> = {
  APPROVED: "Onaylandı",
  PENDING_APPROVAL: "Onay bekliyor",
  CHANGES_REQUESTED: "Düzeltme istendi",
  REJECTED: "Uygun bulunmadı",
  CANCELLED: "İptal edildi",
  MANAGER_NOT_FOUND: "Yönetici bulunamadı",
  DRAFT: "Taslak",
};

export default async function FaaliyetSilmePage({
  searchParams,
}: {
  searchParams: Promise<{ kayit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Yetki sayfanın kendisinde de sorulur: menüde görünmemek bir koruma değil,
  // yalnız bir kolaylıktır.
  if (!user.isRoot) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Faaliyet silme yalnız ana sistem yöneticisine açıktır."
      />
    );
  }

  const { kayit } = await searchParams;
  const hedef = kayit
    ? await describeActivityForDeletion(
        prisma,
        { id: user.id, isRoot: user.isRoot },
        kayit,
      )
    : null;

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Faaliyet silme" }]}
          title="Faaliyet silme"
          description="Silme geri alınamaz ve kaydın bütün geçmişini (revizyonlar, konuşmalar, takip maddeleri, okuma kayıtları, ekler) birlikte götürür. Skor dönemi kapanmış bir kayıt silinemez."
        />

        <AdminNav isRoot={user.isRoot} />

        <Card>
          <CardBody className="flex flex-col gap-4">
            <FaaliyetArama />
          </CardBody>
        </Card>

        {hedef && !hedef.ok ? <Alert tone="danger">{hedef.message}</Alert> : null}

        {hedef?.ok ? (
          <Card>
            <CardBody className="flex flex-col gap-4">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Satir etiket="Başlık" deger={hedef.value.title} />
                <Satir etiket="Yazan" deger={hedef.value.authorName} />
                <Satir etiket="Birim" deger={hedef.value.authorUnitName} />
                <Satir etiket="Tarih" deger={formatDay(hedef.value.activityDate)} />
                <Satir
                  etiket="Durum"
                  deger={
                    DURUM_ETIKETI[hedef.value.approvalStatus] ??
                    hedef.value.approvalStatus
                  }
                />
                <Satir etiket="Ek dosya" deger={`${hedef.value.attachmentCount} adet`} />
              </dl>

              {hedef.value.periodClosed ? (
                <Alert tone="danger">
                  Bu kaydın ait olduğu skor dönemi
                  {hedef.value.periodClosedAt
                    ? ` ${formatDay(hedef.value.periodClosedAt)} tarihinde`
                    : ""}{" "}
                  kapandı. Kapanmış dönemin karnesi bu kayda dayanıyor; silinemez.
                </Alert>
              ) : (
                <Alert tone="waiting">
                  Dönem açık. Silmek için e-postanıza gelecek altı haneli kodu
                  girmeniz gerekir; kod on dakika geçerlidir.
                </Alert>
              )}

              <SilmeAdimlari
                activityId={hedef.value.id}
                silmeAcik={!hedef.value.periodClosed}
              />
            </CardBody>
          </Card>
        ) : null}
      </Page>
    </AppShell>
  );
}

function Satir({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">
        {etiket}
      </dt>
      <dd className="text-sm text-ink">{deger}</dd>
    </div>
  );
}
