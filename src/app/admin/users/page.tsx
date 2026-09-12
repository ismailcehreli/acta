import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { manageableUnitIds } from "@/server/authz/unit-admin";
import { prisma } from "@/server/db";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import {
  countUsers,
  listUsers,
  type UserListFilters,
} from "@/server/users/list";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { SearchField } from "@/components/filters/activity-filters";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import type { UnitChoice } from "./user-form";
import { UserList } from "./user-list";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.users.pageTitle");
}


function toChoices(nodes: OrgUnitNode[], depth = 0): UnitChoice[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toChoices(node.children, depth + 1),
  ]);
}

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    unit?: string;
    status?: string;
    role?: string;
    q?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations();

  // The screen is also available to unit managers; every server action checks
  // its target independently. Hiding the screen is not a security boundary.
  const manageableUnits = await manageableUnitIds(prisma, user.id);
  if (manageableUnits.length === 0) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.users.permission")}
      />
    );
  }

  const isSystemAdmin = canManageOrganization(user);

  const params = await searchParams;

  const filters: UserListFilters = {
    // A unit manager's list is limited to their tree; filters can narrow it but
    // can never expand it.
    orgUnitIds: isSystemAdmin ? undefined : manageableUnits,
    orgUnitId: params.unit || undefined,
    isActive:
      params.status === "active" ? true : params.status === "inactive" ? false : undefined,
    role:
      params.role === "unitManager"
        ? "unitManager"
        : params.role === "systemAdmin"
          ? "systemAdmin"
          : undefined,
    query: params.q || undefined,
  };

  const PAGE_SIZE = await resolvePageSize(params.pageSize);
  const requested = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requested) && requested > 0 ? requested : 1;

  const [total, roots] = await Promise.all([
    countUsers(prisma, filters),
    loadOrgTree(prisma),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  const users = await listUsers(prisma, filters, {
    limit: PAGE_SIZE,
    skip: (currentPage - 1) * PAGE_SIZE,
  });

  const allUnits = toChoices(roots);
  // The unit selector is limited to a manager's tree so another unit cannot be
  // selected for user management.
  const units = isSystemAdmin
    ? allUnits
    : allUnits.filter((unit) => manageableUnits.includes(unit.id));

  const address = (attachment: Record<string, string> = {}) =>
    buildQueryAddress(
      "/admin/users",
      {
        unit: params.unit,
        status: params.status,
        role: params.role,
        q: params.q,
        pageSize: String(PAGE_SIZE),
      },
      attachment,
    );

  const isFiltered =
    Boolean(params.unit) ||
    Boolean(params.status) ||
    Boolean(params.role) ||
    Boolean(params.q);

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page marker="user-management">
        <PageHeader
          title={t("screens.users.pageTitle")}
          description={t("screens.users.pageDescription")}
          breadcrumbs={[{ label: t("screens.users.administration") }, { label: t("screens.users.pageTitle") }]}
          action={
            <ButtonLink href="/admin/users/new" variant="primary">
              {t("screens.users.newUser")}
            </ButtonLink>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <FilterBar
          action="/admin/users"
          clearHref="/admin/users"
          filtered={isFiltered}
          pageSize={PAGE_SIZE}
          extra={<SearchField value={params.q ?? ""} label={t("screens.users.nameOrEmail")} />}
          fields={[
            {
              name: "unit",
              label: t("screens.users.byUnit"),
              value: params.unit ?? "",
              width: "w-52",
              options: [
                { value: "", label: t("screens.users.everyone") },
                ...units.map((u) => ({ value: u.id, label: u.label })),
              ],
            },
            {
              name: "status",
              label: t("screens.users.accountStatus"),
              value: params.status ?? "",
              width: "w-36",
              options: [
                { value: "", label: t("screens.users.everyone") },
                { value: "active", label: t("screens.users.active") },
                { value: "inactive", label: t("screens.users.inactive") },
              ],
            },
            {
              name: "role",
              label: t("screens.users.role"),
              value: params.role ?? "",
              width: "w-44",
              options: [
                { value: "", label: t("screens.users.everyone") },
                { value: "unitManager", label: t("screens.users.unitManager") },
                { value: "systemAdmin", label: t("screens.users.systemAdministrator") },
              ],
            },
          ]}
        />

        <UserList
          users={users}
          returnTo={address()}
        />

        <Pagination
          page={currentPage}
          pageCount={pageCount}
          hrefFor={(pageNumber) =>
            pageNumber === 1 ? address() : address({ page: String(pageNumber) })
          }
          totalLabel={t("screens.users.totalUsers", { count: total })}
        />
      </Page>
    </AppShell>
  );
}
