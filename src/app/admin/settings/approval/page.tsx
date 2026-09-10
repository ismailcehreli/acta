import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export const metadata = { title: "Onay ve takip ayarları" };

export default async function ApprovalSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="approval"
      title="Onay ve takip ayarları"
      description="Onay bekleyen faaliyet, soru-cevap ve takip maddelerinde kullanılan süreleri yönetin."
    >
      <SettingsForm values={await readAllSettings(prisma)} section="approval" />
    </SettingsChrome>
  );
}
