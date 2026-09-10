import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { listAllReasons } from "@/server/approval-reasons/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";

import { ReasonAdmin } from "./reason-admin";

// Onay kararı gerekçeleri (ürün sahibi kararı, 19.08.2026).
//
// Serbest metin raporlanamaz. Kategoriler burada tanımlanır; müdür karar
// verirken bu listeden seçer.

export const metadata = { title: "Onay gerekçeleri" };

export default async function ApprovalReasonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageOrganization(user)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Onay gerekçelerini yalnızca sistem yöneticisi tanımlayabilir."
      />
    );
  }

  const reasons = await listAllReasons(prisma);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Onay gerekçeleri" }]}
          title="Onay gerekçeleri"
          description="Müdür bir faaliyet için düzeltme isterken ya da reddederken bu listeden seçer. Serbest açıklama isteğe bağlıdır; raporlanan kategoridir."
        />

        <AdminNav isRoot={user.isRoot} />

        <ReasonAdmin
          reasons={reasons.map((reason) => ({
            id: reason.id,
            kind: reason.kind,
            label: reason.label,
            sortOrder: reason.sortOrder,
            isActive: reason.isActive,
          }))}
        />
      </Page>
    </AppShell>
  );
}
