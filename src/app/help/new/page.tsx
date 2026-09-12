import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageHelp } from "@/server/authz/help";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { HelpArticleEditor } from "../article-editor";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.help.newTitle");
}

export default async function NewHelpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageHelp(user)) {
    return <PermissionWarning user={user} message={t("screens.help.permissionCreate")} />;
  }

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title={t("screens.help.newTitle")}
          description={t("screens.help.newDescription")}
          breadcrumbs={[
            { label: t("screens.help.dashboard"), href: "/" },
            { label: t("screens.help.title"), href: "/help" },
            { label: t("screens.help.newTitle") },
          ]}
        />
        <HelpArticleEditor />
      </Page>
    </AppShell>
  );
}
