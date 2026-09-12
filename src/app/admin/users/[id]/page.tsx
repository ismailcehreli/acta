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
import { PermissionWarning } from "@/components/shell/permission-warning";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import {
  UserEditForm,
  UserIdentityCard,
  UserSecurityPanel,
} from "../user-admin-forms";
import { AvatarForm } from "../../../users/[id]/avatar-form";
import type { UnitChoice } from "../user-form";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.users.userInformation");
}

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
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/login");
  const t = await getTranslations();

  const { id } = await params;
  const rootSelf = viewer.isRoot && viewer.id === id;
  const canManage = rootSelf || (await canManageUser(prisma, viewer.id, id));

  if (!canManage) {
    return (
      <PermissionWarning
        user={viewer}
        message={t("screens.users.permissionManage")}
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

  const { returnTo: requestedReturnTo } = await searchParams;
  const returnTo = safeReturnTo(requestedReturnTo);

  return (
    <AppShell user={await toShellUser(viewer)}>
      <Page marker="user-profile">
        <PageHeader
          title={target.fullName}
          description={t("screens.users.detailDescription")}
          breadcrumbs={[
            { label: t("screens.users.administration") },
            { label: t("screens.users.pageTitle"), href: returnTo },
            { label: target.fullName },
          ]}
          action={<ButtonLink href={returnTo}>{t("screens.users.backToList")}</ButtonLink>}
        />

        <AdminNav isRoot={viewer.isRoot} />

        <UserIdentityCard user={target} />

        {fullAccess ? (
          <Card>
            <CardBody>
              <AvatarForm
                user={{
                  id: target.id,
                  fullName: target.fullName,
                  avatarExtension: target.avatarExtension,
                }}
                canEdit
              />
            </CardBody>
          </Card>
        ) : null}

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
