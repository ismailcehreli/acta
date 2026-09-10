import Link from "next/link";
import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";

import { SETTINGS_SECTIONS } from "./settings-sections";
import { SettingsChrome } from "./settings-chrome";

export const metadata = { title: "Sistem ayarları" };

export default async function SettingsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageOrganization(user)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Sistem ayarlarını yalnızca sistem yöneticisi değiştirebilir."
      />
    );
  }

  return (
    <SettingsChrome
      user={user}
      title="Sistem ayarları"
      description="Aradığınız ayarı ilgili kısa bölümde bulun. Değişiklikler kaydedildiği anda geçerli olur. Çalışma günleri, mesai saatleri ve resmî tatiller Çalışma takvimi ekranındadır."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.slug}
            href={`/admin/settings/${section.slug}`}
            className="group block"
          >
            <Card className="h-full transition-colors duration-(--duration-fast) group-hover:border-primary-line group-hover:bg-raised">
              <CardHeader title={section.label} />
              <CardBody>
                <p className="text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
                  {section.description}
                </p>
                <span className="mt-4 inline-flex text-[length:var(--text-sm)] font-medium text-primary">
                  Bölümü aç →
                </span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardBody>
          <p className="text-[length:var(--text-sm)] text-muted">
            Bir ayarı değiştirdiğinizde yalnızca o bölümdeki değerler kaydedilir;
            diğer bölümlerdeki ayarlar etkilenmez.
          </p>
        </CardBody>
      </Card>
    </SettingsChrome>
  );
}
