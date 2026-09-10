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

export const metadata = { title: "Yardım ve sık sorulanlar" };

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kategori?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const category = params.kategori?.trim() ?? "";
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
      <Page isaret="yardim">
        <PageHeader
          title="Yardım ve sık sorulanlar"
          description="Sistemdeki bölümleri ve sık kullanılan işlemleri kısa anlatımlarla burada bulabilirsiniz. Aradığınız kelimeyi yazın veya bir bölüm seçin."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Yardım" }]}
          action={
            manager ? (
              <ButtonLink href="/yardim/yeni" variant="primary" size="sm">
                Yeni yazı ekle
              </ButtonLink>
            ) : null
          }
        />

        <Card>
          <CardBody>
            <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Ara</span>
                <Input
                  name="q"
                  defaultValue={query}
                  placeholder="Örn. izin, faaliyet, parola"
                  aria-label="Yardım yazılarında ara"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
                <span className="text-sm font-medium text-ink">Bölüm</span>
                <Select name="kategori" defaultValue={category} aria-label="Yardım bölümü">
                  <option value="">Bütün bölümler</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" variant="secondary">
                Filtrele
              </Button>
              {query || category ? (
                <Link href="/yardim" className="inline-flex h-(--spacing-control) items-center px-2 text-sm text-muted hover:text-ink">
                  Temizle
                </Link>
              ) : null}
            </form>
          </CardBody>
        </Card>

        {articles.length === 0 ? (
          <Card>
            <EmptyState
              title={query || category ? "Aradığınız yazı bulunamadı" : "Henüz yardım yazısı yok"}
              description={
                manager
                  ? "Yeni bir yazı ekleyerek kullanıcıların sık yaptığı işlemleri anlatabilirsiniz."
                  : "Yardım yazıları eklendiğinde burada görünecek."
              }
              action={
                manager ? (
                  <ButtonLink href="/yardim/yeni" size="sm" variant="primary">
                    İlk yazıyı ekle
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
                        {article.isPublished ? "Yayında" : "Taslak"}
                      </Badge>
                    ) : null
                  }
                />
                <CardBody>
                  <details>
                    <summary className="cursor-pointer text-[length:var(--text-sm)] font-medium text-primary underline-offset-4 hover:underline">
                      Yanıtı göster
                    </summary>
                    <p className="mt-3 whitespace-pre-line text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-ink">
                      {article.answer}
                    </p>
                  </details>

                  {manager ? (
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <ButtonLink href={`/yardim/${article.id}/duzenle`} size="sm">
                        Düzenle
                      </ButtonLink>
                      <details>
                        <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-(--radius-sm) border border-danger-line px-2.5 text-[length:var(--text-xs)] font-medium text-danger hover:bg-danger-soft">
                          Arşivle
                        </summary>
                        <form action={archiveHelpArticleAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="id" value={article.id} />
                          <span className="text-xs text-muted">Yazı kullanıcıların ekranından kalkar.</span>
                          <Button type="submit" size="sm" variant="danger">
                            Onayla
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
