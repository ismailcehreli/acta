import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export const metadata = { title: "Bildirim ayarları" };

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="notifications"
      title="Bildirim ayarları"
      description="Hangi olaylarda bildirim gönderileceğini, kanalını ve zamanlanmış iş uyarılarını belirleyin."
    >
      <SettingsForm values={await readAllSettings(prisma)} section="notifications" />
    </SettingsChrome>
  );
}
