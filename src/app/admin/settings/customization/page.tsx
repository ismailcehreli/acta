import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { readBranding } from "@/server/settings/branding";
import { prisma } from "@/server/db";

import { BrandingForm } from "../branding-form";
import { SettingsChrome } from "../settings-chrome";

export const metadata = { title: "Özelleştirme" };

export default async function CustomizationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="customization"
      title="Özelleştirme"
      description="Uygulamanın kullanıcıların gördüğü logo, sayfa başlığı ve alt şerit metnini düzenleyin."
    >
      <BrandingForm branding={await readBranding(prisma)} />
    </SettingsChrome>
  );
}
