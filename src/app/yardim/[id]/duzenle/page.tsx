import { notFound, redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageHelp } from "@/server/authz/help";
import { getHelpArticle } from "@/server/help/articles";
import { prisma } from "@/server/db";

import { HelpArticleEditor } from "../../editor-form";

export const metadata = { title: "Yardım yazısını düzenle" };

export default async function EditHelpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageHelp(user)) {
    return <YetkiUyarisi user={user} mesaj="Yardım yazısı düzenlemek için yönetici yetkisi gerekir." />;
  }

  const { id } = await params;
  const article = await getHelpArticle(prisma, id, true);
  if (!article) notFound();

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title="Yardım yazısını düzenle"
          description="Değişiklikleri kaydettiğinizde kullanıcılar güncel metni görür."
          breadcrumbs={[
            { label: "Ana ekran", href: "/" },
            { label: "Yardım", href: "/yardim" },
            { label: "Düzenle" },
          ]}
        />
        <HelpArticleEditor article={article} />
      </Page>
    </AppShell>
  );
}
