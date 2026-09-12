import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { demoDataPresent } from "@/server/demo/purge";
import { listLegacyDemoOriginCandidates } from "@/server/demo/origin";
import { prisma } from "@/server/db";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { DemoForm } from "../demo-form";
import { SettingsChrome } from "../settings-chrome";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.settingsPage.details.demoTitle");
}

export default async function DemoSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageOrganization(user)) {
    return <PermissionWarning user={user} message={t("screens.settingsPage.permission")} />;
  }

  const [installed, legacyOriginCandidates] = await Promise.all([
    demoDataPresent(prisma),
    listLegacyDemoOriginCandidates(prisma),
  ]);

  return (
    <SettingsChrome
      user={user}
      section="demo"
      title={t("screens.settingsPage.details.demoTitle")}
      description={t("screens.settingsPage.details.demoDescription")}
    >
      <DemoForm installed={installed} legacyOriginCandidates={legacyOriginCandidates} />
    </SettingsChrome>
  );
}
