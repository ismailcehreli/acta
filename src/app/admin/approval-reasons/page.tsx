import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { listAllReasons } from "@/server/approval-reasons/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { getTranslations } from "@/server/i18n/server";

import { ReasonAdmin } from "./reason-admin";


//



export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("screens.approvalReasons.pageTitle") };
}

export default async function ApprovalReasonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.approvalReasons.permission")}
      />
    );
  }

  const reasons = await listAllReasons(prisma);

  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <PageHeader
          breadcrumbs={[
            { label: t("screens.approvalReasons.dashboard"), href: "/" },
            { label: t("screens.approvalReasons.pageTitle") },
          ]}
          title={t("screens.approvalReasons.pageTitle")}
          description={t("screens.approvalReasons.pageDescription")}
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
