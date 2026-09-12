"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "@/components/i18n";

import type { ManagedUser } from "@/server/users/list";
import { formatInstantShort } from "@/shared/format/date-time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";





function roleBadges(user: ManagedUser, t: ReturnType<typeof useTranslations>) {
  const roleLabels = [
    user.isRoot ? t("screens.users.primarySystemAdministrator") : null,
    user.isUnitManager ? t("screens.users.unitManager") : null,
    user.isSystemAdmin && !user.isRoot ? t("screens.users.systemAdministrator") : null,
    !user.writesActivities ? t("screens.users.doesNotWriteActivities") : null,
  ].filter(Boolean) as string[];

  if (roleLabels.length === 0) {
    return <span className="text-muted">—</span>;
  }

  return (
    <span className="flex flex-wrap gap-1">
      {roleLabels.map((label) => (
        <Badge
          key={label}
          tone={
            label === t("screens.users.primarySystemAdministrator") ||
            label === t("screens.users.systemAdministrator")
              ? "primary"
              : "neutral"
          }
        >
          {label}
        </Badge>
      ))}
    </span>
  );
}

function UserRow({
  user,
  returnTo,
  t,
  locale,
}: {
  user: ManagedUser;
  returnTo: string;
  t: ReturnType<typeof useTranslations>;
  locale: ReturnType<typeof useLocale>;
}) {
  const detailHref = `/admin/users/${user.id}?${new URLSearchParams({ returnTo }).toString()}`;

  return (
    <TR data-test="user-row">
      <TD>
        <Link href={detailHref} className="group flex items-center gap-2">
          <Avatar user={user} size={32} locale={locale} />
          <span className="min-w-0">
            <span className="block font-medium text-ink group-hover:text-primary group-hover:underline">
              {user.fullName}
            </span>
            {user.title ? (
              <span className="block text-xs text-ink">{user.title}</span>
            ) : null}
            <span className="block text-xs text-muted">{user.email}</span>
          </span>
        </Link>
      </TD>
      <TD>{user.orgUnitName}</TD>
      <TD>{roleBadges(user, t)}</TD>
      <TD>
        <span
          className="flex flex-col gap-1"
          data-status={user.isActive ? "active" : "inactive"}
        >
            {user.isActive ? (
            <Badge tone="success">{t("screens.users.active")}</Badge>
          ) : (
            <Badge tone="neutral">{t("screens.users.inactive")}</Badge>
          )}
          <span className="text-xs text-muted">
            {user.lastLoginAt
              ? t("screens.users.lastSignInAt", { date: formatInstantShort(user.lastLoginAt, locale) })
              : t("screens.users.neverSignedIn")}
          </span>
        </span>
      </TD>
      <TD align="right">
        <ButtonLink href={detailHref} size="sm">
          {t("screens.users.openDetails")}
        </ButtonLink>
      </TD>
    </TR>
  );
}

export function UserList({
  users,
  returnTo = "/admin/users",
}: {
  users: ManagedUser[];
  /** Preserve list filters when returning from the detail view. */
  returnTo?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <Card>
      <CardHeader
        title={t("screens.users.listTitle")}
        description={t("screens.users.listDescription")}
      />

      {users.length === 0 ? (
        <EmptyState title={t("screens.users.noMatches")} />
      ) : (
        <CardBody className="p-0">
          <Table label={t("screens.users.listTable")}>
            <THead>
              <TR>
                <TH>{t("screens.users.user")}</TH>
                <TH>{t("screens.users.unit")}</TH>
                <TH>{t("screens.users.roles")}</TH>
                <TH>{t("screens.users.statusLastSignIn")}</TH>
                <TH align="right">{t("screens.users.actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} returnTo={returnTo} t={t} locale={locale} />
              ))}
            </TBody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}
