import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/shell/admin-nav";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";

import { OrgUnitForm, type UnitOption } from "../org-form";

export const metadata = { title: "Yeni birim — Yönetim" };

function toOptions(nodes: OrgUnitNode[], depth = 0): UnitOption[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toOptions(node.children, depth + 1),
  ]);
}

export default async function NewOrgUnitAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageOrganization(user)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Yeni birim eklemek için sistem yöneticisi yetkisi gerekir."
      />
    );
  }

  const roots = await loadOrgTree(prisma);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page isaret="birim-ekle">
        <PageHeader
          title="Yeni birim"
          description="Birim adını, kademesini ve varsa üst birimini seçin. Birimin yeri daha sonra organizasyon ağacından değiştirilebilir."
          breadcrumbs={[
            { label: "Yönetim" },
            { label: "Organizasyon", href: "/admin/org" },
            { label: "Yeni birim" },
          ]}
          action={<ButtonLink href="/admin/org">Ağaca dön</ButtonLink>}
        />

        <AdminNav isRoot={user.isRoot} />

        <OrgUnitForm options={toOptions(roots)} />
      </Page>
    </AppShell>
  );
}
