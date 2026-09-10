import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export const metadata = { title: "Genel ve faaliyet ayarları" };

export default async function GeneralSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="general"
      title="Genel ve faaliyet ayarları"
      description="Faaliyet başlıklarının ve açıklamalarının sınırlarını, geçmişe dönük giriş süresini ve kişinin kendisi için gün ekleme sınırını belirleyin."
    >
      <SettingsForm values={await readAllSettings(prisma)} section="general" />
    </SettingsChrome>
  );
}
