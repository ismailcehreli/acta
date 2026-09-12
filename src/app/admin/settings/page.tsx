import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionWarning } from "@/components/shell/permission-warning";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { SETTINGS_SECTIONS } from "./settings-sections";
import { SettingsChrome } from "./settings-chrome";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.settingsPage.title");
}

export default async function SettingsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.settingsPage.permission")}
      />
    );
  }

  return (
    <SettingsChrome
      user={user}
      title={t("screens.settingsPage.title")}
      description={t("screens.settingsPage.description")}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.slug}
            href={`/admin/settings/${section.slug}`}
            className="group block"
          >
            <Card className="h-full transition-colors duration-(--duration-fast) group-hover:border-primary-line group-hover:bg-raised">
              <CardHeader title={t(section.labelKey)} />
              <CardBody>
                <p className="text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
                  {t(section.descriptionKey)}
                </p>
                <span className="mt-4 inline-flex text-[length:var(--text-sm)] font-medium text-primary">
                  {t("screens.settingsPage.openSection")}
                </span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardBody>
          <p className="text-[length:var(--text-sm)] text-muted">
            {t("screens.settingsPage.note")}
          </p>
        </CardBody>
      </Card>
    </SettingsChrome>
  );
}
