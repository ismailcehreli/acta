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
import { PermissionWarning } from "@/components/shell/permission-warning";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { UserForm, type UnitChoice } from "../user-form";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.users.newUser");
}

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
  const t = await getTranslations();

  const manageable = await manageableUnitIds(prisma, user.id);
  if (manageable.length === 0) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.users.newPermission")}
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
      <Page marker="new-user">
        <PageHeader
          title={t("screens.users.newUser")}
          description={t("screens.users.newDescription")}
          breadcrumbs={[
            { label: t("screens.users.administration") },
            { label: t("screens.users.pageTitle"), href: "/admin/users" },
            { label: t("screens.users.newUser") },
          ]}
          action={<ButtonLink href="/admin/users">{t("screens.users.listBack")}</ButtonLink>}
        />

        <AdminNav isRoot={user.isRoot} />

        <UserForm
          units={units}
          isSystemAdmin={canManageOrganization(user)}
        />
      </Page>
    </AppShell>
  );
}
