import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageFeedback } from "@/server/authz/feedback";
import {
  feedbackCategoryLabel,
  feedbackStatusLabel,
  listManageableFeedback,
  listOwnFeedback,
  type FeedbackView,
} from "@/server/feedback/service";
import { prisma } from "@/server/db";
import { formatInstantShort } from "@/shared/format/date-time";

import { FeedbackAdmin, type FeedbackClientView } from "./feedback-admin";
import { FeedbackForm } from "./feedback-form";

export const metadata = { title: "Geri bildirim" };

const STATUS_TONES = {
  NEW: "neutral",
  IN_REVIEW: "waiting",
  RESOLVED: "success",
} as const;

function serializeFeedback(item: FeedbackView): FeedbackClientView {
  return {
    ...item,
    readAt: item.readAt?.toISOString() ?? null,
    reviewedAt: item.reviewedAt?.toISOString() ?? null,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function zaman(value: Date | null): string | null {
  return value ? formatInstantShort(value) : null;
}

const GERI_BILDIRIM_SEKMELERI = [
  { href: "/feedback", label: "Yeni geri bildirim", key: "gonder" },
  { href: "/feedback?sekme=gecmis", label: "Gönderdiklerim", key: "gecmis" },
] as const;

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ sekme?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const yonetici = canManageFeedback(user);
  const params = await searchParams;
  const sekmeler = yonetici
    ? [
        ...GERI_BILDIRIM_SEKMELERI,
        { href: "/feedback?sekme=yonetim", label: "Yönetim", key: "yonetim" },
      ]
    : GERI_BILDIRIM_SEKMELERI;
  const secilebilirSekme = sekmeler.some((item) => item.key === params.sekme)
    ? (params.sekme as (typeof sekmeler)[number]["key"])
    : "gonder";
  const aktifSekme =
    sekmeler.find((item) => item.key === secilebilirSekme) ?? sekmeler[0];

  const [own, manageable] = await Promise.all([
    secilebilirSekme === "gecmis"
      ? listOwnFeedback(prisma, user.id)
      : Promise.resolve([] as FeedbackView[]),
    secilebilirSekme === "yonetim" && yonetici
      ? listManageableFeedback(prisma, user.id)
      : Promise.resolve([] as FeedbackView[]),
  ]);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page isaret="geri-bildirim">
        <PageHeader
          title="Geri bildirim"
          description="Hata, öneri, eleştiri veya sorularınızı uygulama içinden iletin. Gönderdiğiniz kayıtların durumunu ve yönetici yanıtını yine burada takip edebilirsiniz."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Geri bildirim" }]}
        />

        <AdminTabs
          tabs={sekmeler.map(({ href, label }) => ({ href, label }))}
          activeHref={aktifSekme.href}
        />

        {secilebilirSekme === "gonder" ? <FeedbackForm /> : null}

        {secilebilirSekme === "gecmis" ? (
          <Card>
            <CardHeader
              title="Gönderdiğim geri bildirimler"
              description="Yöneticiler kaydınızı okuduğunda ve incelemeye başladığında bu bilgiler burada görünür."
            />
            {own.length === 0 ? (
              <EmptyState
                title="Henüz geri bildirim göndermediniz"
                description="Karşılaştığınız bir sorunu veya geliştirme fikrinizi yeni geri bildirim bölümünden paylaşabilirsiniz."
              />
            ) : (
              <CardBody className="flex flex-col gap-4">
                {own.map((item) => (
                  <article key={item.id} className="border-b border-line pb-4 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-ink">{item.title}</p>
                        <p className="mt-1 text-[length:var(--text-xs)] text-muted">
                          {feedbackCategoryLabel(item.category)} · {formatInstantShort(item.createdAt)}
                          {item.adminsOnly ? " · Yalnızca sistem yöneticileri" : ""}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONES[item.status]}>{feedbackStatusLabel(item.status)}</Badge>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-ink">
                      {item.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[length:var(--text-xs)] text-muted">
                      <span>
                        Okundu: {item.readAt ? `${item.readByName ?? "Yönetici"} · ${zaman(item.readAt)}` : "Henüz değil"}
                      </span>
                      {item.reviewedAt ? (
                        <span>
                          İnceleme başladı: {item.reviewedByName ?? "Yönetici"} · {zaman(item.reviewedAt)}
                        </span>
                      ) : null}
                      {item.resolvedAt ? (
                        <span>
                          Çözüldü: {item.resolvedByName ?? "Yönetici"} · {zaman(item.resolvedAt)}
                        </span>
                      ) : null}
                    </div>
                    {item.response ? (
                      <div className="mt-3 border-s-2 border-primary-line ps-3 text-[length:var(--text-sm)] text-muted">
                        <span className="font-medium text-ink">Yönetici yanıtı:</span> {item.response}
                      </div>
                    ) : null}
                  </article>
                ))}
              </CardBody>
            )}
          </Card>
        ) : null}

        {secilebilirSekme === "yonetim" && yonetici ? (
          <section id="geri-bildirim-yonetimi" className="flex flex-col gap-4 scroll-mt-6">
            <div>
              <h2 className="text-[length:var(--text-xl)] font-semibold text-ink">Geri bildirim yönetimi</h2>
              <p className="mt-1 text-[length:var(--text-sm)] text-muted">
                Tüm kullanıcıların geri bildirimlerini buradan okuyup yanıtlayabilirsiniz.
              </p>
            </div>
            {manageable.length === 0 ? (
              <Card>
                <EmptyState title="Bekleyen geri bildirim yok" description="Yeni bir kayıt geldiğinde burada görünecek." />
              </Card>
            ) : (
              <FeedbackAdmin feedback={manageable.map(serializeFeedback)} />
            )}
          </section>
        ) : null}
      </Page>
    </AppShell>
  );
}
