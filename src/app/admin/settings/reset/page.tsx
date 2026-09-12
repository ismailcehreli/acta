import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { latestSystemResetRequest } from "@/server/reset/service";
import { prisma } from "@/server/db";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { ResetForm } from "./reset-form";
import { SettingsChrome } from "../settings-chrome";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.settingsForms.reset.title");
}

export default async function ResetSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageOrganization(user)) {
    return <PermissionWarning user={user} message={t("screens.settingsForms.reset.permission")} />;
  }

  return (
    <SettingsChrome
      user={user}
      section="reset"
      title={t("screens.settingsForms.reset.title")}
      description={t("screens.settingsForms.reset.description")}
    >
      <ResetForm lastRequest={await latestSystemResetRequest(prisma)} />
    </SettingsChrome>
  );
}
