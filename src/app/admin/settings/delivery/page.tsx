import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readSmtpView } from "@/server/settings/smtp";
import { readVapidView } from "@/server/settings/vapid";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { SettingsChrome } from "../settings-chrome";
import { PushForm } from "../push-form";
import { SmtpForm } from "../smtp-form";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.settingsPage.details.deliveryTitle");
}

export default async function DeliverySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();
  if (!canManageOrganization(user)) {
    return <PermissionWarning user={user} message={t("screens.settingsPage.permission")} />;
  }

  const [smtp, vapid, subscriberCount] = await Promise.all([
    readSmtpView(prisma),
    readVapidView(prisma),
    prisma.pushSubscription.count(),
  ]);

  return (
    <SettingsChrome
      user={user}
      section="delivery"
      title={t("screens.settingsPage.details.deliveryTitle")}
      description={t("screens.settingsPage.details.deliveryDescription")}
    >
      <SmtpForm view={smtp} />
      <PushForm view={{ ...vapid, subscriberCount }} />
    </SettingsChrome>
  );
}
