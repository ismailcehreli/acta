import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.settingsPage.details.accountsTitle");
}

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageOrganization(user)) {
    return <PermissionWarning user={user} message={t("screens.settingsPage.permission")} />;
  }

  return (
    <SettingsChrome
      user={user}
      section="accounts"
      title={t("screens.settingsPage.details.accountsTitle")}
      description={t("screens.settingsPage.details.accountsDescription")}
    >
      <SettingsForm values={await readAllSettings(prisma)} section="accounts" />
    </SettingsChrome>
  );
}
