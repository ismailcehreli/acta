import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export const metadata = { title: "Dosya eki ayarları" };

export default async function FileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="files"
      title="Dosya ekleri"
      description="Faaliyetlere eklenebilecek dosyaların tek dosya boyutunu ve toplam adetini belirleyin."
    >
      <SettingsForm values={await readAllSettings(prisma)} section="files" />
    </SettingsChrome>
  );
}
