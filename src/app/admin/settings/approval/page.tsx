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
  return getLocalizedMetadata("screens.settingsPage.details.approvalTitle");
}

export default async function ApprovalSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageOrganization(user)) {
    return <PermissionWarning user={user} message={t("screens.settingsPage.permission")} />;
  }

  return (
    <SettingsChrome
      user={user}
      section="approval"
      title={t("screens.settingsPage.details.approvalTitle")}
      description={t("screens.settingsPage.details.approvalDescription")}
    >
      <SettingsForm values={await readAllSettings(prisma)} section="approval" />
    </SettingsChrome>
  );
}
