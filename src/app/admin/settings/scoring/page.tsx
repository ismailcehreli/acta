import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readAllSettings } from "@/server/settings/system-settings";

import { SettingsChrome } from "../settings-chrome";
import { SettingsForm } from "../settings-form";

export const metadata = { title: "Skor ayarları" };

export default async function ScoringSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="scoring"
      title="Skor ayarları"
      description="Skor sistemini açın, üç kalemin ağırlığını ve skor ekranındaki seçenekleri yönetin. Ağırlık değişikliği açık dönemi etkiler; kapanmış dönemler korunur."
    >
      <SettingsForm values={await readAllSettings(prisma)} section="scoring" />
    </SettingsChrome>
  );
}
