import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import type { UnitOption } from "./org-form";
import { OrgTree } from "./org-tree";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.organization.pageTitle");
}
function toOptions(nodes: OrgUnitNode[], depth = 0): UnitOption[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toOptions(node.children, depth + 1),
  ]);
}

export default async function OrgAdminPage() {
  const user = await getCurrentUser();
  const t = await getTranslations();

  if (!user) redirect("/login");

  // Hiding the screen is not authorization; server actions enforce the same check.
  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.organization.permission")}
      />
    );
  }

  const roots = await loadOrgTree(prisma);
  const options = toOptions(roots);

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page>
        <PageHeader
          title={t("screens.organization.pageTitle")}
          description={t("screens.organization.pageDescription")}
          breadcrumbs={[
            { label: t("screens.organization.administration") },
            { label: t("screens.organization.pageTitle") },
          ]}
          action={
            <ButtonLink href="/admin/org/new" variant="primary">
              {t("screens.organization.newUnit")}
            </ButtonLink>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <Card>
          <CardHeader title={t("screens.organization.currentTree")} />
          <CardBody>
            <OrgTree roots={roots} options={options} />
          </CardBody>
        </Card>

      </Page>
    </AppShell>
  );
}
