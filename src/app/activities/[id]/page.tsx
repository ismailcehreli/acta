import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { canViewActivity } from "@/server/authz/visibility";
import { canAskQuestion } from "@/server/conversations/service";
import { listActivityConversations } from "@/server/conversations/read";
import { prisma } from "@/server/db";
import { listActivityAttachments } from "@/server/attachments/service";
import { appSecret } from "@/server/auth/config";
import { listActivityReaders } from "@/server/reads/service";
import { issueReadTicket } from "@/server/reads/ticket";
import { listActiveReasons } from "@/server/approval-reasons/service";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import {
  findLatestClosedFollowUp,
  findOpenFollowUp,
} from "@/server/follow-ups/read";
import { isInManagementChain } from "@/server/org/chain";

import { subordinateUserIds } from "@/server/authz/visibility";
import { AttachmentGallery } from "@/components/activities/attachment-gallery";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";

import { canDecideOnActivity } from "@/server/activities/approval";

import { ApprovalPanel } from "./approval-panel";
import { FollowUpPanel } from "./follow-up-panel";
import { AskQuestionForm, ConversationList } from "./conversation-panel";
import { ReadTracker } from "./read-tracker";
import { formatDay, formatInstant } from "@/shared/format/date-time";
import { describeActivityDates } from "@/shared/format/activity-dates";
import { countAppreciations } from "@/server/scoring/appreciation";
import {
  readBooleanSetting,
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";

import { AppreciateButton } from "./appreciate-button";

export const metadata = { title: "Faaliyet" };

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const viewer = { id: user.id, isSystemAdmin: user.isSystemAdmin };

  const activity = await activityMaintenanceReader(prisma).findUnique({
    where: { id },
    select: {
      id: true,
      activityNo: true,
      authorId: true,
      approvalStatus: true,
      activityDate: true,
      createdAt: true,
      updatedAt: true,
      currentRevisionNo: true,
      title: true,
      description: true,
      author: { select: { fullName: true, title: true, avatarExtension: true } },
      authorOrgUnit: { select: { name: true } },
      targetDepts: { select: { orgUnit: { select: { name: true } } } },
      cancellation: { select: { reason: true } },
      approverId: true,
      approvalReasonNote: true,
      approvalReason: { select: { label: true } },
      approver: { select: { fullName: true } },
    },
  });

  // Her okuma yolu görünürlük modülünden geçer (§8.4).
  const level = activity
    ? await canViewActivity(prisma, viewer, activity)
    : "none";

  // Görülemeyen kaydın varlığı da bildirilmez.
  if (!activity || level === "none") notFound();

  const iptal = activity.approvalStatus === "CANCELLED";

  // Faaliyetin iki tarihi: ait olduğu gün ve yazıldığı an (Görev 11.1).
  // Geçmişe dönük girişte ikisi ayrışır ve okuyanın bunu görmesi gerekir.
  // Takdir yalnız yetkili kullanıcıya gösterilir; asıl kural serviste.
  const [takdirAcik, takdirSayisi, kendiTakdiri] = await Promise.all([
    readBooleanSetting(prisma, SETTING_KEYS.appreciationEnabled),
    countAppreciations(prisma, activity.id),
    prisma.activityAppreciation.findUnique({
      where: { activityId_userId: { activityId: activity.id, userId: user.id } },
      select: { userId: true },
    }),
  ]);

  const tarihler = describeActivityDates({
    ...activity,
    revisionNo: activity.currentRevisionNo,
  });

  // Üst veri seviyesinde açıklama ve konuşmalar gösterilmez (§8.2).
  if (level === "metadata") {
    return (
      <AppShell
        user={await toShellUser(user)}
      >
        <Page>
          <PageHeader
            title={activity.title}
            description={`${activity.author.fullName} · ${formatDay(activity.activityDate)}`}
            breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Faaliyet" }]}
          />
          <Card>
            <CardBody>
              <p className="text-sm text-muted">
                Bu kayıt yönlendirme bekliyor. İçeriğini görüntüleme yetkiniz
                yok: sistem yöneticiliği hesapları ve ayarları yönetmeye
                yarar, faaliyet içeriğini okumaya değil.
              </p>
            </CardBody>
          </Card>
        </Page>
      </AppShell>
    );
  }

  const [
    conversations,
    sorabilir,
    readers,
    attachments,
    subordinates,
    readDwellSeconds,
  ] = await Promise.all([
    listActivityConversations(prisma, viewer, activity.id),
    canAskQuestion(prisma, viewer, activity),
    listActivityReaders(prisma, viewer, activity.id),
    listActivityAttachments(prisma, viewer, activity.id),
    subordinateUserIds(prisma, user.id),
    readNumericSetting(prisma, SETTING_KEYS.readDwellSeconds),
  ]);

  const yazanMi = activity.authorId === user.id;
  // Onay kararı uygun onaylayıcılara düşer (§8.2) — iki müdürlü birimde
  // ikisine, vekâlet süresince vekile de. Yetki sunucu eyleminde ayrıca
  // doğrulanır; buradaki tek iş paneli göstermek. Aynı fonksiyonu kullanmak,
  // "düğme yok ama eylem kabul ediyor" ayrışmasını engelliyor.
  const onaylayanMi = await canDecideOnActivity(prisma, user.id, activity.id);
  const onayBekliyor = activity.approvalStatus === "PENDING_APPROVAL";
  const duzeltmeIsteniyor = activity.approvalStatus === "CHANGES_REQUESTED";
  const reddedildi = activity.approvalStatus === "REJECTED";
  // Karar hâlâ onaylayıcıdaysa panel gösterilir. Düzeltme istenmiş kayıtta
  // onaylanacak bir şey yoktur ama **reddetme** durur: yazan kaydı hiç
  // düzeltmezse kayıt aksi hâlde sonsuza kadar askıda kalırdı.
  const kararBekliyor = onayBekliyor || duzeltmeIsteniyor;

  // Takip maddesi (§11). Yalnız içeriği tam görebilen kişiye çizilir; yetkinin
  // kendisi sunucu eyleminde ayrıca doğrulanıyor.
  const [acikTakip, kapaliTakip, takvimAyarlari] = await Promise.all([
    findOpenFollowUp(prisma, activity.id),
    findLatestClosedFollowUp(prisma, activity.id),
    readWorkCalendar(prisma),
  ]);

  const simdi = new Date();
  const takipHareketsizlik = acikTakip
    ? businessDaysBetween(acikTakip.lastMovedAt, simdi, {
        workingDays: takvimAyarlari.workingDays,
      })
    : 0;

  const takipYonetebilir = acikTakip
    ? acikTakip.ownerId === user.id ||
      acikTakip.openedById === user.id ||
      (await isInManagementChain(prisma, acikTakip.ownerId, user.id))
    : kapaliTakip
      ? kapaliTakip.ownerId === user.id ||
        kapaliTakip.openedById === user.id ||
        (await isInManagementChain(prisma, kapaliTakip.ownerId, user.id))
      : false;

  // Gerekçe katalogları yalnız karar verecek kişiye yüklenir.
  const [changesReasons, rejectReasons] =
    kararBekliyor && onaylayanMi
      ? await Promise.all([
          listActiveReasons(prisma, "CHANGES_REQUESTED"),
          listActiveReasons(prisma, "REJECTED"),
        ])
      : [[], []];

  return (
    <AppShell
      user={await toShellUser(user, subordinates)}
    >
      <Page>
        <PageHeader
          title={
            <span className={iptal ? "text-muted line-through" : undefined}>
              {activity.title}
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* Sıra numarası (§3.1): konuşurken ve belgede atıf verirken
                  kullanılan kısa kimlik. */}
              <span className="tabular text-muted">#{activity.activityNo}</span>
              <span aria-hidden>·</span>
              {/* Yazarın profili: kayda bakan kişi zaten adı görüyor, bağlantı
                  yeni bilgi vermez. Profil sayfası erişimi kendi denetler. */}
              <Avatar
                user={{
                  id: activity.authorId,
                  fullName: activity.author.fullName,
                  avatarExtension: activity.author.avatarExtension,
                }}
                size={24}
              />
              <Link
                href={`/users/${activity.authorId}`}
                className="font-medium text-ink hover:underline"
              >
                {activity.author.fullName}
              </Link>
              {/* Unvan yetki değildir; okuyanın "bu kişi ne iş yapıyor"
                  sorusuna cevap verir. Boşsa ayraç da yazılmaz. */}
              {activity.author.title ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{activity.author.title}</span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span>{activity.authorOrgUnit.name}</span>
              <span aria-hidden>·</span>
              <time dateTime={activity.activityDate.toISOString().slice(0, 10)}>
                {tarihler.main}
              </time>
              {iptal ? <Badge tone="danger">iptal edildi</Badge> : null}
              {onayBekliyor ? <Badge tone="waiting">onay bekliyor</Badge> : null}
              {duzeltmeIsteniyor ? (
                <Badge tone="correction">düzeltme istendi</Badge>
              ) : null}
              {reddedildi ? <Badge tone="danger">reddedildi</Badge> : null}
              {activity.approvalStatus === "MANAGER_NOT_FOUND" ? (
                <Badge tone="danger">yönetici bulunamadı</Badge>
              ) : null}
              {activity.currentRevisionNo > 1 ? (
                <Badge tone="neutral">
                  düzenlendi (rev. {activity.currentRevisionNo})
                </Badge>
              ) : null}
            </span>
          }
          breadcrumbs={[
            { label: "Ana ekran", href: "/" },
            yazanMi
              ? { label: "Faaliyetlerim", href: "/activities" }
              : { label: "Faaliyet" },
            ...(yazanMi ? [{ label: "Kayıt" }] : []),
          ]}
        />

        {/* Onay durumu kaydın en üstünde: kim ne yapacak, sayfayı okumadan
            görünmeli. */}

        {/* ── Belge + karar rayı (brief §5, §7) ─────────────────────
            Masaüstünde içerik solda belge yüzeyinde, kararlar sağda dar
            bir rayda. Dar ekranda ray belgenin **altına** iner: karar
            eylemleri içeriği kapatmaz, kullanıcı önce kaydı okur. */}
        <div className="grid gap-(--spacing-section) xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-8">
          <div className="flex min-w-0 flex-col gap-(--spacing-block)">
        <Card>
          <CardBody className="flex flex-col gap-4">
            {activity.targetDepts.length > 0 ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="text-muted">İlgili departmanlar:</span>
                {activity.targetDepts.map((t) => (
                  <Badge key={t.orgUnit.name}>{t.orgUnit.name}</Badge>
                ))}
              </p>
            ) : null}

            <p className="whitespace-pre-line leading-relaxed text-ink">
              {activity.description}
            </p>

            {takdirAcik && user.canAppreciate ? (
              <div className="border-t border-line pt-3">
                <AppreciateButton
                  activityId={activity.id}
                  count={takdirSayisi}
                  already={kendiTakdiri !== null}
                />
              </div>
            ) : takdirAcik && takdirSayisi > 0 ? (
              <p className="border-t border-line pt-3 text-[length:var(--text-sm)] text-muted">
                Bu kayıt {takdirSayisi} takdir aldı.
              </p>
            ) : null}

            {/* Kaydın künyesi: ne zaman yazıldı, düzeltildiyse ne zaman.
                Faaliyetin tarihi başlıkta duruyor; bu satır "bu kayıt ne
                zaman tutuldu" sorusunun cevabı. Geçmişe dönük girişte ikisi
                ayrışır ve fark okunabilir olmalı. */}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[length:var(--text-xs)] text-muted">
              <time dateTime={activity.createdAt.toISOString()}>
                {tarihler.created}
              </time>
              {tarihler.revised ? (
                <>
                  <span aria-hidden>·</span>
                  <time
                    dateTime={activity.updatedAt.toISOString()}
                    className="font-medium text-ink"
                  >
                    {tarihler.revised}
                  </time>
                </>
              ) : null}
            </p>

            {iptal && activity.cancellation ? (
              <div className="rounded-(--radius-sm) border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm">
                <span className="font-medium">İptal gerekçesi:</span>{" "}
                {activity.cancellation.reason}
              </div>
            ) : null}

            {/* Resim, PDF ve video sayfadan çıkmadan açılır; diğer türler
                eskisi gibi indirilir (§15.4). */}
            <AttachmentGallery attachments={attachments} />

            {readers.length > 0 ? (
              <p
                id="okundu-bilgisi"
                className="border-t border-line pt-4 text-sm text-muted"
              >
                {yazanMi
                  ? `Okuyanlar: ${readers
                      .map(
                        (reader) =>
                          `${reader.fullName} · ${formatInstant(reader.firstReadAt)}`,
                      )
                      .join(", ")}`
                  : `Bu faaliyeti ${formatInstant(readers[0].firstReadAt)} tarihinde okudunuz.`}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Sorular"
            description="Sorulan soru cevaplanana kadar hem soranın hem cevaplaması gerekenin listesinde durur. Kimse unutmaya güvenmez."
          />
          <CardBody>
            <ConversationList
              conversations={conversations}
              viewerId={user.id}
              viewerIsSystemAdmin={user.isSystemAdmin}
            />
            {sorabilir && !iptal ? (
              <div className="mt-4 border-t border-line pt-4">
                <AskQuestionForm activityId={activity.id} />
              </div>
            ) : null}
          </CardBody>
        </Card>

          </div>

          <aside aria-label="Karar ve takip" className="flex min-w-0 flex-col gap-(--spacing-block)">
        {kararBekliyor && onaylayanMi ? (
          <Card>
            <CardHeader
              title={onayBekliyor ? "Onayınızı bekliyor" : "Düzeltme bekleniyor"}
              description={
                onayBekliyor
                  ? activity.currentRevisionNo > 1
                    ? "Bu faaliyet düzeltilerek tekrar onayınıza sunulmuştur. Onaylarsanız üst kademeler görebilir."
                    : "Onaylarsanız üst kademeler görebilir. Düzeltme isterseniz kayıt yazana geri döner. Reddederseniz kayıt kapanır ve yukarı akmaz."
                  : "Yazan kişi kaydı henüz düzeltmedi. Düzeltmeyle kurtulmayacak bir kayıtsa reddedebilirsiniz."
              }
            />
            <CardBody>
              <ApprovalPanel
                activityId={activity.id}
                canApprove={onayBekliyor}
                changesReasons={changesReasons}
                rejectReasons={rejectReasons}
              />
            </CardBody>
          </Card>
        ) : null}

        {onayBekliyor && yazanMi ? (
          <Alert tone="info" title="Onay bekliyor">
            {activity.approver
              ? `${activity.approver.fullName} onayladıktan sonra üst kademeler görebilecek.`
              : "Onaylandıktan sonra üst kademeler görebilecek."}{" "}
            Bu sırada kayıt değiştirilemez.
          </Alert>
        ) : null}

        {duzeltmeIsteniyor && activity.approvalReason ? (
          <Card data-test="duzeltme-gerekcesi">
            <CardHeader
              title="Düzeltme istendi"
              description={
                activity.approver
                  ? `${activity.approver.fullName} şunu istedi:`
                  : undefined
              }
              action={
                yazanMi ? (
                  <ButtonLink
                    href={`/activities/${activity.id}/edit`}
                    variant="primary"
                    size="sm"
                  >
                    Düzelt
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody>
              <p className="font-medium text-ink">{activity.approvalReason.label}</p>
              {activity.approvalReasonNote ? (
                <p className="mt-1 whitespace-pre-line text-muted">
                  {activity.approvalReasonNote}
                </p>
              ) : null}
              {yazanMi ? (
                <p className="mt-3 text-[length:var(--text-sm)] text-muted">
                  Düzeltip kaydettiğinizde kayıt yeniden onaya gider.
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {reddedildi && activity.approvalReason ? (
          <Card data-test="ret-gerekcesi">
            <CardHeader
              title="Uygun bulunmadı"
              description={
                activity.approver
                  ? `${activity.approver.fullName} bu kaydı reddetti. Kayıt kapandı ve üst kademelere akmadı.`
                  : "Kayıt kapandı ve üst kademelere akmadı."
              }
            />
            <CardBody>
              <p className="font-medium text-ink">{activity.approvalReason.label}</p>
              {activity.approvalReasonNote ? (
                <p className="mt-1 whitespace-pre-line text-muted">
                  {activity.approvalReasonNote}
                </p>
              ) : null}
              {yazanMi ? (
                <p className="mt-3 text-[length:var(--text-sm)] text-muted">
                  Bu kayıt düzenlenemez. Gerekiyorsa yeni bir faaliyet yazın.
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <FollowUpPanel
          activityId={activity.id}
          item={
            acikTakip
              ? {
                  id: acikTakip.id,
                  ownerName: acikTakip.owner.fullName,
                  openedByName: acikTakip.openedBy.fullName,
                  nextStep: acikTakip.nextStep,
                  reviewDate: acikTakip.reviewDate
                    ? formatDay(acikTakip.reviewDate)
                    : null,
                  idleBusinessDays: takipHareketsizlik,
                }
              : null
          }
          closed={
            !acikTakip && kapaliTakip && kapaliTakip.closedAt
              ? {
                  id: kapaliTakip.id,
                  closedByName: kapaliTakip.closedBy?.fullName ?? "—",
                  closingNote: kapaliTakip.closingNote ?? "",
                  closedAt: formatDay(kapaliTakip.closedAt),
                }
              : null
          }
          canManage={takipYonetebilir}
          canOpen={!iptal && !reddedildi}
        />

          </aside>
        </div>

        {/* Okuma ölçümü yalnızca başkasının kaydında anlamlıdır. */}
        {yazanMi ? null : (
          <ReadTracker
            activityId={activity.id}
            dwellMs={readDwellSeconds * 1_000}
            // Bilet burada, görünürlük doğrulandıktan sonra üretilir; zamanı
            // sunucu koyar (§10.2).
            ticket={issueReadTicket(activity.id, user.id, new Date(), appSecret())}
          />
        )}
      </Page>
    </AppShell>
  );
}
