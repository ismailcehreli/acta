import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";

import { PasswordForm } from "./password-form";

export const metadata = { title: "Parola değiştir" };

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <AppShell user={await toShellUser(user)} allowPasswordChange>
      <Page>
        <PageHeader
          title="Parola değiştir"
          description="Parolanızı değiştirdiğinizde açık olan tüm oturumlarınız kapanır ve yeniden giriş yapmanız gerekir."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Parola" }]}
        />

        <Card>
          <CardHeader title="Yeni parola" description="En az 10 karakter." />
          <CardBody>
            <PasswordForm />
          </CardBody>
        </Card>
      </Page>
    </AppShell>
  );
}
