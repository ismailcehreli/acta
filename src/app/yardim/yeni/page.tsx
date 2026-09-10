import { redirect } from "next/navigation";

import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Page, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageHelp } from "@/server/authz/help";

import { HelpArticleEditor } from "../editor-form";

export const metadata = { title: "Yeni yardım yazısı" };

export default async function NewHelpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageHelp(user)) {
    return <YetkiUyarisi user={user} mesaj="Yardım yazısı eklemek için yönetici yetkisi gerekir." />;
  }

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          title="Yeni yardım yazısı"
          description="Kullanıcıların sık yaptığı bir işlemi kısa ve anlaşılır şekilde anlatın."
          breadcrumbs={[
            { label: "Ana ekran", href: "/" },
            { label: "Yardım", href: "/yardim" },
            { label: "Yeni yazı" },
          ]}
        />
        <HelpArticleEditor />
      </Page>
    </AppShell>
  );
}
