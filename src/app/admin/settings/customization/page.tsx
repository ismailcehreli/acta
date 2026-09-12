import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { readBranding } from "@/server/settings/branding";
import { prisma } from "@/server/db";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { BrandingForm } from "../branding-form";
import { SettingsChrome } from "../settings-chrome";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.settingsPage.details.customizationTitle");
}

export default async function CustomizationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageOrganization(user)) {
    return <PermissionWarning user={user} message={t("screens.settingsPage.permission")} />;
  }

  return (
    <SettingsChrome
      user={user}
      section="customization"
      title={t("screens.settingsPage.details.customizationTitle")}
      description={t("screens.settingsPage.details.customizationDescription")}
    >
      <BrandingForm branding={await readBranding(prisma)} />
    </SettingsChrome>
  );
}
