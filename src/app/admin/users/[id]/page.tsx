import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { canManageUser, manageableUnitIds } from "@/server/authz/unit-admin";
import { prisma } from "@/server/db";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import { getManagedUser } from "@/server/users/list";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/shell/admin-nav";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";

import {
  UserEditForm,
  UserIdentityCard,
  UserSecurityPanel,
} from "../user-admin-forms";
import type { UnitChoice } from "../user-form";

export const metadata = { title: "Kullanıcı detayı — Yönetim" };

function toChoices(nodes: OrgUnitNode[], depth = 0): UnitChoice[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toChoices(node.children, depth + 1),
  ]);
}

function safeReturnTo(value: string | undefined): string {
  return value?.startsWith("/admin/users") ? value : "/admin/users";
}

export default async function UserAdminDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donus?: string }>;
}) {
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/login");

  const { id } = await params;
  const rootSelf = viewer.isRoot && viewer.id === id;
  const canManage = rootSelf || (await canManageUser(prisma, viewer.id, id));

  if (!canManage) {
    return (
      <YetkiUyarisi
        user={viewer}
        mesaj="Bu kullanıcı üzerinde işlem yapma yetkiniz yok. Ana sistem yöneticisi hesabı korunur."
      />
    );
  }

  const target = await getManagedUser(prisma, id);
  if (!target) notFound();

  const fullAccess = canManageOrganization(viewer) && !rootSelf;
  const mode = rootSelf
    ? "root-self"
    : fullAccess
      ? "system-admin"
      : "unit-manager";

  let units: UnitChoice[] = [];
  if (fullAccess || rootSelf) {
    const [roots, manageable] = await Promise.all([
      loadOrgTree(prisma),
      manageableUnitIds(prisma, viewer.id),
    ]);
    const allUnits = toChoices(roots);
    units = fullAccess
      ? allUnits
      : allUnits.filter((unit) => manageable.includes(unit.id));
  }

  const { donus } = await searchParams;
  const returnTo = safeReturnTo(donus);

  return (
    <AppShell user={await toShellUser(viewer)}>
      <Page isaret="kullanici-detayi">
        <PageHeader
          title={target.fullName}
          description="Bu ekran yalnızca tek bir hesabı yönetmek içindir. Listeye döndüğünüzde arama ve filtreler korunur."
          breadcrumbs={[
            { label: "Yönetim" },
            { label: "Kullanıcılar", href: returnTo },
            { label: target.fullName },
          ]}
          action={<ButtonLink href={returnTo}>Listeye dön</ButtonLink>}
        />

        <AdminNav isRoot={viewer.isRoot} />

        <UserIdentityCard user={target} />

        <UserEditForm user={target} units={units} mode={mode} />

        {!rootSelf ? (
          <UserSecurityPanel
            user={target}
            canSetPassword={fullAccess}
            canCloseConversations={fullAccess}
          />
        ) : null}
      </Page>
    </AppShell>
  );
}
