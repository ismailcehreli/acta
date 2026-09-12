import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/shell/admin-nav";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { OrgUnitForm, type UnitOption } from "../org-form";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.organization.newUnit");
}

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
  const t = await getTranslations();
  if (!user) redirect("/login");

  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.organization.permission")}
      />
    );
  }

  const roots = await loadOrgTree(prisma);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page marker="new-organization-unit">
        <PageHeader
          title={t("screens.organization.newUnit")}
          description={t("screens.organization.newUnitDescription")}
          breadcrumbs={[
            { label: t("screens.organization.administration") },
            { label: t("screens.organization.pageTitle"), href: "/admin/org" },
            { label: t("screens.organization.newUnit") },
          ]}
          action={
            <ButtonLink href="/admin/org">
              {t("common.back")}
            </ButtonLink>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <OrgUnitForm options={toOptions(roots)} />
      </Page>
    </AppShell>
  );
}
