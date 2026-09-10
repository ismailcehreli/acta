import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { demoDataPresent } from "@/server/demo/purge";
import { listLegacyDemoOriginCandidates } from "@/server/demo/origin";
import { prisma } from "@/server/db";

import { DemoForm } from "../demo-form";
import { SettingsChrome } from "../settings-chrome";

export const metadata = { title: "Örnek veri" };

export default async function DemoSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarı yalnızca sistem yöneticisi değiştirebilir." />;
  }

  const [installed, legacyOriginCandidates] = await Promise.all([
    demoDataPresent(prisma),
    listLegacyDemoOriginCandidates(prisma),
  ]);

  return (
    <SettingsChrome
      user={user}
      section="demo"
      title="Örnek veri"
      description="Sistemi tanımak için anlaşılır bir örnek şirket, kullanıcılar ve iş kayıtları kurun."
    >
      <DemoForm installed={installed} legacyOriginCandidates={legacyOriginCandidates} />
    </SettingsChrome>
  );
}
