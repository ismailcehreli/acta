import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApprovalBadge } from "@/components/activities/approval-badge";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader, Stat, StatStrip } from "@/components/ui/page";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { readVapidPublicKey } from "@/server/settings/vapid";
import { listProfileActivities, loadProfile } from "@/server/users/profile";
import { PushToggle } from "@/components/push/push-toggle";

import { NotificationModeForm } from "./notification-mode-form";
import { AvatarForm } from "./avatar-form";
import { formatDay, formatInstant } from "@/shared/format/date-time";
import { readScoreTrend, readUserScore } from "@/server/scoring/read";
import { ScoreCard } from "@/components/scoring/score-card";

// Kişi profili: kim olduğu, kaç faaliyet yazdığı ve arşivi.
//
// Arşivde kişinin **bütün** kayıtları listelenir — onay bekleyenler dahil
// (ürün sahibi kararı, 19.08.2026). Gizlemek çalışanı cezalandırırdı: müdürü
// onaylamayınca az çalışmış gibi görünürdü.
//
// Ama **varlık görünür, içerik görünmez**: süzülmemiş kayda bağlantı
// verilmez. Kararı görünürlük modülü veriyor; profil kendi kuralını
// uydurmuyor.

export const metadata = { title: "Profil" };

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const viewer = {
    id: user.id,
    isSystemAdmin: user.isSystemAdmin,
    isUnitManager: user.isUnitManager,
    orgUnitId: user.orgUnitId,
  };

  const profil = await loadProfile(prisma, viewer, id, new Date());

  // Görme yetkisi yoksa kayıt yokmuş gibi davranılır: "yetkiniz yok" demek,
  // kişinin var olduğunu ele verirdi.
  if (profil.access === "none") notFound();

  // Skor **bakan kişinin kapsamına göre** okunuyor; kapsam dışıysa `null`
  // döner ve blok hiç çizilmez (Görev 11.10).
  const [skor, trend] = await Promise.all([
    readUserScore(prisma, viewer, id, new Date()),
    readScoreTrend(prisma, viewer, id),
  ]);

  const shellUser = await toShellUser(user);
  const kendisi = profil.person.id === user.id;

  const roller = [
    profil.person.isSystemAdmin ? "Sistem yöneticisi" : null,
    profil.person.isUnitManager ? "Birim yöneticisi" : null,
  ].filter((rol): rol is string => rol !== null);

  return (
    <AppShell user={shellUser}>
      <Page>
        <PageHeader
          breadcrumbs={
            kendisi
              ? [{ label: "Ana ekran", href: "/" }, { label: "Profilim" }]
              : [{ label: "Ana ekran", href: "/" }, { label: profil.person.fullName }]
          }
          title={profil.person.fullName}
          marker={profil.person.title ?? undefined}
          description={`${profil.person.orgUnitName} · ${profil.person.email}`}
        />

        {skor ? (
          <Card>
            <CardHeader
              title="Bu dönemki skor"
              description={`${kendisi ? "Temel puanınız" : "Temel puan"} üç bölümden oluşur; takdir katkısı genel puana ayrıca eklenebilir. Sistem ayarlarından kapatılırsa bu bölüm görünmez.`}
            />
            <CardBody>
              <ScoreCard
                score={skor}
                appreciations={null}
                trend={trend}
                self={kendisi}
              />
            </CardBody>
          </Card>
        ) : null}

        {/* Profil resmi (Görev 11.5). Kişinin kendisi ve sistem yöneticisi
            değiştirebilir; başkası yalnız görür. */}
        <Card>
          <CardBody>
            <AvatarForm
              user={{
                id: profil.person.id,
                fullName: profil.person.fullName,
                avatarExtension: profil.person.avatarExtension,
              }}
              canEdit={kendisi || user.isSystemAdmin}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Kişi" />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {roller.map((rol) => (
                <Badge key={rol} tone="primary">
                  {rol}
                </Badge>
              ))}
              {roller.length === 0 ? <Badge>Kullanıcı</Badge> : null}

              {profil.person.isActive ? null : <Badge tone="danger">Pasif</Badge>}

              {/* §7.4 istisnası: yönetim kurulu üyesi gibi kişilerden faaliyet
                  beklenmez. Bunu profilde göstermek, "hiç yazmamış" görüntüsünü
                  açıklar. */}
              {profil.person.writesActivities ? null : (
                <Badge tone="neutral">Faaliyet yazması beklenmiyor</Badge>
              )}
            </div>
            {profil.person.lastLoginVisible ? (
              <p className="mt-3 text-[length:var(--text-sm)] text-muted">
                <span className="font-medium text-ink">Son başarılı giriş:</span>{" "}
                {profil.person.lastLoginAt
                  ? formatInstant(profil.person.lastLoginAt)
                  : "Henüz başarılı giriş yok"}
              </p>
            ) : null}
          </CardBody>
        </Card>

        {/* Bildirim ayarı **yalnız kişinin kendi profilinde**: başkasının
            cihazına abone olmak diye bir şey yok. */}
        {kendisi ? (
          <Card>
            <CardHeader
              title="Tarayıcı bildirimleri"
              description="Ayar bu cihaza özeldir; her tarayıcıda ayrı açılır."
            />
            <CardBody>
              <PushToggle publicKey={await readVapidPublicKey(prisma)} />
            </CardBody>
          </Card>
        ) : null}

        {kendisi ? (
          <Card>
            <CardHeader
              title="E-posta bildirimleri"
              description="Tercih bütün cihazlarınız için geçerlidir."
            />
            <CardBody>
              <NotificationModeForm current={user.notificationMode} />
            </CardBody>
          </Card>
        ) : null}

        {profil.access === "metadata" ? (
          <Card>
            <CardBody>
              <p className="text-[length:var(--text-sm)] text-muted">
                Sistem yöneticisi yetkisi kullanıcıyı yönetmeye yeter; faaliyet
                içeriğine erişim vermez. Bu kişinin arşivi burada gösterilmez.
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            {/* Özet, dekoratif kart koleksiyonu değil ölçüm şeridi (brief §6).
                Dört sayı bir kişinin kayıt ritmini okutur; her birine ayrı
                kutu çizmek sayıları değil kutuları öne çıkarırdı. */}
            <section aria-labelledby="ozet-basligi">
              <h2 id="ozet-basligi" className="section-label mb-2">
                Özet
              </h2>
              <StatStrip>
                <Stat label="Toplam" value={profil.stats.total} />
                <Stat label="Bu ay" value={profil.stats.thisMonth} tone="primary" />
                <Stat
                  label="Onay bekleyen"
                  value={profil.stats.pending}
                  tone={profil.stats.pending > 0 ? "correction" : "neutral"}
                  hint={
                    profil.stats.pending > 0
                      ? "Bekleyen iş kişide değil, onaylayıcısındadır."
                      : undefined
                  }
                />
                <Stat
                  label="Son faaliyet"
                  value={
                    profil.stats.lastActivityDate
                      ? formatDay(profil.stats.lastActivityDate)
                      : "—"
                  }
                />
              </StatStrip>
            </section>

            <ProfileArchive viewer={viewer} userId={profil.person.id} />
          </>
        )}
      </Page>
    </AppShell>
  );
}

async function ProfileArchive({
  viewer,
  userId,
}: {
  viewer: { id: string; isSystemAdmin: boolean };
  userId: string;
}) {
  const kayitlar = await listProfileActivities(prisma, viewer, userId);

  return (
    <Card>
      <CardHeader
        title="Arşiv"
        description={
          kayitlar.length === 0
            ? undefined
            : `Son ${kayitlar.length} faaliyet, yeniden eskiye.`
        }
      />

      {kayitlar.length === 0 ? (
        <CardBody>
          <p className="text-[length:var(--text-sm)] text-muted">
            Gösterilecek faaliyet yok.
          </p>
        </CardBody>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH align="right">No</TH>
              <TH>Tarih</TH>
              <TH>Başlık</TH>
              <TH>Durum</TH>
            </TR>
          </THead>
          <TBody>
            {kayitlar.map((kayit) => (
              <TR key={kayit.id} data-test="profil-faaliyet">
                <TD align="right" className="tabular text-muted">
                  {kayit.activityNo}
                </TD>
                <TD className="whitespace-nowrap text-muted">
                  {formatDay(kayit.activityDate)}
                </TD>
                <TD>
                  <Link
                    href={`/activities/${kayit.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {kayit.title}
                  </Link>
                </TD>
                <TD>
                  <ApprovalBadge status={kayit.approvalStatus} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
