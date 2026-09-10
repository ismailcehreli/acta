import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export const metadata = { title: "Hesap ve güvenlik ayarları" };

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="accounts"
      title="Hesaplar ve güvenlik"
      description="Yeni hesapların e-posta alan adlarını, oturum süresini ve başarısız girişlerdeki hesap kilidini yönetin."
    >
      <SettingsForm values={await readAllSettings(prisma)} section="accounts" />
    </SettingsChrome>
  );
}
