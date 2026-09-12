import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { PasswordForm } from "./password-form";

export async function generateMetadata() {
  return getLocalizedMetadata("auth.changePassword");
}

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const t = await getTranslations();

  return (
    <AppShell user={await toShellUser(user)} allowPasswordChange>
      <Page>
        <PageHeader
          title={t("auth.changePassword")}
          description={t("auth.passwordPageDescription")}
          breadcrumbs={[{ label: t("nav.today"), href: "/" }, { label: t("auth.changePassword") }]}
        />

        <Card>
          <CardHeader title={t("auth.newPassword")} description={t("auth.passwordMinimumHint")} />
          <CardBody>
            <PasswordForm />
          </CardBody>
        </Card>
      </Page>
    </AppShell>
  );
}
