import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocale } from "@/server/i18n/locale";
import { canManageFeedback } from "@/server/authz/feedback";
import {
  listManageableFeedback,
  listOwnFeedback,
  type FeedbackView,
} from "@/server/feedback/service";
import { prisma } from "@/server/db";
import { formatInstantShort } from "@/shared/format/date-time";
import { getTranslations } from "@/server/i18n/server";

import { FeedbackAdmin, type FeedbackClientView } from "./feedback-admin";
import { FeedbackForm } from "./feedback-form";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("screens.feedback.pageTitle") };
}

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

function time(
  value: Date | null,
  locale: Parameters<typeof formatInstantShort>[1],
): string | null {
  return value ? formatInstantShort(value, locale) : null;
}

const FEEDBACK_TABS = [
  { href: "/feedback", key: "new" },
  { href: "/feedback?tab=history", key: "history" },
] as const;

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  const manager = canManageFeedback(user);
  const params = await searchParams;
  const tabler = manager
    ? [
        ...FEEDBACK_TABS,
        { href: "/feedback?tab=management", key: "management" },
      ]
    : FEEDBACK_TABS;
  const selectedTab = tabler.some((item) => item.key === params.tab)
    ? (params.tab as (typeof tabler)[number]["key"])
    : "new";
  const activeTab = tabler.find((item) => item.key === selectedTab) ?? tabler[0];

  const [own, manageable] = await Promise.all([
    selectedTab === "history"
      ? listOwnFeedback(prisma, user.id)
      : Promise.resolve([] as FeedbackView[]),
    selectedTab === "management" && manager
      ? listManageableFeedback(prisma, user.id)
      : Promise.resolve([] as FeedbackView[]),
  ]);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page marker="feedback">
        <PageHeader
          title={t("screens.feedback.pageTitle")}
          description={t("screens.feedback.pageDescription")}
          breadcrumbs={[{ label: t("screens.feedback.dashboard"), href: "/" }, { label: t("screens.feedback.pageTitle") }]}
        />

        <AdminTabs
          tabs={tabler.map(({ href, key }) => ({
            href,
            label:
              key === "new"
                ? t("screens.feedback.newTab")
                : key === "history"
                  ? t("screens.feedback.historyTab")
                  : t("screens.feedback.managementTab"),
          }))}
          activeHref={activeTab.href}
        />

        {selectedTab === "new" ? <FeedbackForm /> : null}

        {selectedTab === "history" ? (
          <Card>
            <CardHeader
              title={t("screens.feedback.historyTitle")}
              description={t("screens.feedback.historyDescription")}
            />
            {own.length === 0 ? (
              <EmptyState
                title={t("screens.feedback.noOwnFeedback")}
                description={t("screens.feedback.noOwnFeedbackDescription")}
              />
            ) : (
              <CardBody className="flex flex-col gap-4">
                {own.map((item) => (
                  <article key={item.id} className="border-b border-line pb-4 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-ink">{item.title}</p>
                        <p className="mt-1 text-[length:var(--text-xs)] text-muted">
                          {t(`screens.feedback.${item.category === "BUG" ? "bug" : item.category === "SUGGESTION" ? "suggestion" : item.category === "CRITIQUE" ? "criticism" : "question"}`)} · {formatInstantShort(item.createdAt, locale)}
                          {item.adminsOnly ? ` · ${t("screens.feedback.administratorsOnly")}` : ""}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONES[item.status]}>
                        {t(`screens.feedback.${item.status === "NEW" ? "newStatus" : item.status === "IN_REVIEW" ? "inReviewStatus" : "resolvedStatus"}`)}
                      </Badge>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-ink">
                      {item.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[length:var(--text-xs)] text-muted">
                      <span>
                          {t("screens.feedback.read")}: {item.readAt ? `${item.readByName ?? t("screens.feedback.manager")} · ${time(item.readAt, locale)}` : t("screens.feedback.notYet")}
                      </span>
                      {item.reviewedAt ? (
                        <span>
                          {t("screens.feedback.reviewStarted")}: {item.reviewedByName ?? t("screens.feedback.manager")} · {time(item.reviewedAt, locale)}
                        </span>
                      ) : null}
                      {item.resolvedAt ? (
                        <span>
                          {t("screens.feedback.resolved")}: {item.resolvedByName ?? t("screens.feedback.manager")} · {time(item.resolvedAt, locale)}
                        </span>
                      ) : null}
                    </div>
                    {item.response ? (
                      <div className="mt-3 border-s-2 border-primary-line ps-3 text-[length:var(--text-sm)] text-muted">
                        <span className="font-medium text-ink">{t("screens.feedback.managerResponse")}</span> {item.response}
                      </div>
                    ) : null}
                  </article>
                ))}
              </CardBody>
            )}
          </Card>
        ) : null}

        {selectedTab === "management" && manager ? (
          <section id="feedback-management" className="flex flex-col gap-4 scroll-mt-6">
            <div>
              <h2 className="text-[length:var(--text-xl)] font-semibold text-ink">{t("screens.feedback.managementTitle")}</h2>
              <p className="mt-1 text-[length:var(--text-sm)] text-muted">
                {t("screens.feedback.managementDescription")}
              </p>
            </div>
            {manageable.length === 0 ? (
              <Card>
                <EmptyState title={t("screens.feedback.noPending")} description={t("screens.feedback.noPendingDescription")} />
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
