import { notFound, redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageHelp } from "@/server/authz/help";
import { getHelpArticle } from "@/server/help/articles";
import { prisma } from "@/server/db";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { HelpArticleEditor } from "../../article-editor";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.help.editTitle");
}

export default async function EditHelpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageHelp(user)) {
    return <PermissionWarning user={user} message={t("screens.help.permissionEdit")} />;
  }

  const { id } = await params;
  const article = await getHelpArticle(prisma, id, true);
  if (!article) notFound();

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title={t("screens.help.editTitle")}
          description={t("screens.help.editDescription")}
          breadcrumbs={[
            { label: t("screens.help.dashboard"), href: "/" },
            { label: t("screens.help.title"), href: "/help" },
            { label: t("screens.help.edit") },
          ]}
        />
        <HelpArticleEditor article={article} />
      </Page>
    </AppShell>
  );
}
