import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { readSmtpView } from "@/server/settings/smtp";
import { readVapidView } from "@/server/settings/vapid";

import { SettingsChrome } from "../settings-chrome";
import { PushForm } from "../push-form";
import { SmtpForm } from "../smtp-form";

export const metadata = { title: "E-posta ve tarayıcı bildirimleri" };

export default async function DeliverySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageOrganization(user)) {
    return <YetkiUyarisi user={user} mesaj="Bu ayarları yalnızca sistem yöneticisi değiştirebilir." />;
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
      title="E-posta ve tarayıcı bildirimleri"
      description="Bildirimlerin dışarıya nasıl gönderileceğini burada kurun. Olay bazında açıp kapatma Bildirimler bölümündedir."
    >
      <SmtpForm view={smtp} />
      <PushForm view={{ ...vapid, subscriberCount }} />
    </SettingsChrome>
  );
}
