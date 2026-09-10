import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { manageableUnitIds } from "@/server/authz/unit-admin";
import { prisma } from "@/server/db";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/shell/admin-nav";
import { toShellUser } from "@/components/shell/shell-user";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";

import { UserForm, type UnitChoice } from "../user-form";

export const metadata = { title: "Yeni kullanıcı — Yönetim" };

function toChoices(nodes: OrgUnitNode[], depth = 0): UnitChoice[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toChoices(node.children, depth + 1),
  ]);
}

export default async function NewUserAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const manageable = await manageableUnitIds(prisma, user.id);
  if (manageable.length === 0) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Yeni kullanıcı eklemek için sistem yöneticisi ya da birim yöneticisi yetkisi gerekir."
      />
    );
  }

  const roots = await loadOrgTree(prisma);
  const allUnits = toChoices(roots);
  const units = canManageOrganization(user)
    ? allUnits
    : allUnits.filter((unit) => manageable.includes(unit.id));

  return (
    <AppShell user={await toShellUser(user)}>
      <Page isaret="kullanici-ekle">
        <PageHeader
          title="Yeni kullanıcı"
          description="Hesap açın, bağlı olduğu birimi seçin ve gerekirse rolünü belirleyin."
          breadcrumbs={[
            { label: "Yönetim" },
            { label: "Kullanıcılar", href: "/admin/users" },
            { label: "Yeni kullanıcı" },
          ]}
          action={<ButtonLink href="/admin/users">Listeye dön</ButtonLink>}
        />

        <AdminNav isRoot={user.isRoot} />

        <UserForm
          units={units}
          sistemYoneticisi={canManageOrganization(user)}
        />
      </Page>
    </AppShell>
  );
}
