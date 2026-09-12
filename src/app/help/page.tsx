import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageHelp } from "@/server/authz/help";
import {
  archiveHelpArticleAction,
} from "./actions";
import { listHelpArticles, listHelpCategories } from "@/server/help/articles";
import { prisma } from "@/server/db";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.help.title");
}

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const t = await getTranslations();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const category = params.category?.trim() ?? "";
  const manager = canManageHelp(user);

  const [articles, categories] = await Promise.all([
    listHelpArticles(prisma, {
      search: query,
      category: category || undefined,
      includeUnpublished: manager,
    }),
    listHelpCategories(prisma, manager),
  ]);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page marker="help">
        <PageHeader
          title={t("screens.help.title")}
          description={t("screens.help.description")}
          breadcrumbs={[{ label: t("screens.help.dashboard"), href: "/" }, { label: t("screens.help.title") }]}
          action={
            manager ? (
              <ButtonLink href="/help/new" variant="primary" size="sm">
                {t("screens.help.addArticle")}
              </ButtonLink>
            ) : null
          }
        />

        <Card>
          <CardBody>
            <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">{t("screens.help.searchLabel")}</span>
                <Input
                  name="q"
                  defaultValue={query}
                  placeholder={t("screens.help.searchPlaceholder")}
                  aria-label={t("screens.help.searchAriaLabel")}
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
                <span className="text-sm font-medium text-ink">{t("screens.help.categoryLabel")}</span>
                <Select name="category" defaultValue={category} aria-label={t("screens.help.categoryAriaLabel")}>
                  <option value="">{t("screens.help.allCategories")}</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" variant="secondary">
                {t("screens.help.filter")}
              </Button>
              {query || category ? (
                <Link href="/help" className="inline-flex h-(--spacing-control) items-center px-2 text-sm text-muted hover:text-ink">
                  {t("screens.help.clear")}
                </Link>
              ) : null}
            </form>
          </CardBody>
        </Card>

        {articles.length === 0 ? (
          <Card>
            <EmptyState
              title={query || category ? t("screens.help.noMatch") : t("screens.help.noArticles")}
              description={
                manager
                  ? t("screens.help.managerEmpty")
                  : t("screens.help.userEmpty")
              }
              action={
                manager ? (
                  <ButtonLink href="/help/new" size="sm" variant="primary">
                    {t("screens.help.addFirst")}
                  </ButtonLink>
                ) : null
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {articles.map((article) => (
              <Card key={article.id}>
                <CardHeader
                  title={article.title}
                  description={article.category}
                  action={
                    manager ? (
                      <Badge tone={article.isPublished ? "success" : "neutral"}>
                        {article.isPublished ? t("screens.help.published") : t("screens.help.draft")}
                      </Badge>
                    ) : null
                  }
                />
                <CardBody>
                  <details>
                    <summary className="cursor-pointer text-[length:var(--text-sm)] font-medium text-primary underline-offset-4 hover:underline">
                      {t("screens.help.showAnswer")}
                    </summary>
                    <p className="mt-3 whitespace-pre-line text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-ink">
                      {article.answer}
                    </p>
                  </details>

                  {manager ? (
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <ButtonLink href={`/help/${article.id}/edit`} size="sm">
                        {t("screens.help.edit")}
                      </ButtonLink>
                      <details>
                        <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-(--radius-sm) border border-danger-line px-2.5 text-[length:var(--text-xs)] font-medium text-danger hover:bg-danger-soft">
                          {t("screens.help.archive")}
                        </summary>
                        <form action={archiveHelpArticleAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="id" value={article.id} />
                          <span className="text-xs text-muted">{t("screens.help.archiveHint")}</span>
                          <Button type="submit" size="sm" variant="danger">
                            {t("screens.help.confirmArchive")}
                          </Button>
                        </form>
                      </details>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </Page>
    </AppShell>
  );
}
