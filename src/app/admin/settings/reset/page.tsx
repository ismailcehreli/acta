import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { latestSystemResetRequest } from "@/server/reset/service";
import { prisma } from "@/server/db";

import { ResetForm } from "./reset-form";
import { SettingsChrome } from "../settings-chrome";

export const metadata = { title: "Başlangıca dönüş" };

export default async function ResetSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu işlemi yalnızca sistem yöneticisi başlatabilir." />;
  }

  return (
    <SettingsChrome
      user={user}
      section="reset"
      title="Başlangıca dönüş"
      description="Uygulamayı yeni bir başlangıç yöneticisiyle boş duruma getirin. Bu işlem yalnızca üretim öncesi veya bilinçli bir yeniden kurulum kararı için kullanılmalıdır."
    >
      <ResetForm lastRequest={await latestSystemResetRequest(prisma)} />
    </SettingsChrome>
  );
}
