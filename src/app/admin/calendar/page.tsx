import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { listHolidays, readWorkCalendar } from "@/server/calendar/settings";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { PermissionWarning } from "@/components/shell/permission-warning";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDay, toDateValue } from "@/shared/format/date-time";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import {
  loadUnitCalendarIndex,
  resolveUnitWorkWindowFrom,
} from "@/server/calendar/unit-calendar";
import { minuteToTime } from "@/shared/schemas/calendar";
import { getLocale } from "@/server/i18n/locale";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import {
  UnitCalendarForm,
  type UnitCalendarRow,
} from "./unit-calendar-form";

import {
  AddHolidayForm,
  RemoveHolidayButton,
  WorkCalendarForm,
} from "./calendar-forms";

export async function generateMetadata() {
  return getLocalizedMetadata("screens.calendar.pageTitle");
}

function dayLabel(
  date: string,
  locale: Parameters<typeof formatDay>[1],
): string {
  return formatDay(toDateValue(date), locale);
}

const CALENDAR_TABS = [
  { href: "/admin/calendar", key: "overview" },
  { href: "/admin/calendar?tab=units", key: "units" },
  { href: "/admin/calendar?tab=holidays", key: "holidays" },
] as const;

export default async function CalendarAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const locale = await getLocale();
  const t = await getTranslations(locale);

  if (!canManageOrganization(user)) {
    return (
      <PermissionWarning
        user={user}
        message={t("screens.calendar.permission")}
      />
    );
  }

  const year = new Date().getUTCFullYear();
  const params = await searchParams;
  const tab = CALENDAR_TABS.some((item) => item.key === params.tab)
    ? (params.tab as (typeof CALENDAR_TABS)[number]["key"])
    : "overview";
  const activeTab = CALENDAR_TABS.find((item) => item.key === tab) ?? CALENDAR_TABS[0];
  const [calendar, holidays, unitTree] = await Promise.all([
    readWorkCalendar(prisma),
    listHolidays(prisma),
    loadOrgTree(prisma),
  ]);

  const flatUnits: { id: string; label: string; depth: number }[] = [];
  const write = (nodes: OrgUnitNode[], depth = 0) => {
    for (const node of nodes) {
      if (node.isActive) {
        flatUnits.push({ id: node.id, label: `${"— ".repeat(depth)}${node.name}`, depth });
      }
      write(node.children, depth + 1);
    }
  };
  write(unitTree);

  // Load the tree and calendar index once. Resolving each row separately used
  // to reload every unit and every unit calendar.
  const calendarIndex = await loadUnitCalendarIndex(prisma);

  const unitRows: UnitCalendarRow[] = flatUnits.map((unit) => {
      const window = resolveUnitWorkWindowFrom(calendarIndex, unit.id);
      return {
        id: unit.id,
        label: unit.label,
        workingDays: window.workingDays,
        workStart: minuteToTime(window.workStartMinute),
        workEnd: minuteToTime(window.workEndMinute),
        worksOnHolidays: window.worksOnHolidays,
        source: window.source,
        sourceUnitName: window.sourceUnitName,
      };
  });

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page marker="work-calendar">
        <PageHeader
          title={t("screens.calendar.pageTitle")}
          description={t("screens.calendar.pageDescription")}
          breadcrumbs={[{ label: t("screens.calendar.administration") }, { label: t("screens.calendar.pageTitle") }]}
        />

        <AdminNav isRoot={user.isRoot} />

        <AdminTabs
          tabs={CALENDAR_TABS.map(({ href, key }) => ({
            href,
            label: t(
              key === "overview"
                ? "screens.calendar.tabOverview"
                : key === "units"
                  ? "screens.calendar.tabUnits"
                  : "screens.calendar.tabHolidays",
            ),
          }))}
          activeHref={activeTab.href}
        />

        {tab === "overview" ? (
          <Card>
            <CardHeader
              title={t("screens.calendar.companyDefaultTitle")}
              description={t("screens.calendar.companyDefaultDescription")}
            />
            <CardBody>
              <WorkCalendarForm calendar={calendar} />
            </CardBody>
          </Card>
        ) : null}

        {tab === "units" ? (
          <Card>
            <CardHeader
              title={t("screens.calendar.unitWindowTitle")}
              description={t("screens.calendar.unitWindowDescription")}
            />
            <CardBody>
              <UnitCalendarForm units={unitRows} />
            </CardBody>
          </Card>
        ) : null}

        {tab === "holidays" ? (
          <Card>
            <CardHeader
              title={t("screens.calendar.holidayTitle")}
              description={t("screens.calendar.holidayDescription")}
            />
            <CardBody>
              <AddHolidayForm />
            </CardBody>

            {holidays.length === 0 ? (
              <EmptyState
                title={t("screens.calendar.noHolidays")}
                description={t("screens.calendar.noHolidaysDescription", { year })}
              />
            ) : (
              <Table label={t("screens.calendar.pageTitle")}>
                <THead>
                  <TR>
                    <TH>{t("common.date")}</TH>
                    <TH>{t("common.description")}</TH>
                    <TH align="right">{t("common.actions")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {holidays.map((holiday) => (
                    <TR key={holiday.date}>
                      <TD className="whitespace-nowrap font-medium tabular">
                        {dayLabel(holiday.date, locale)}
                      </TD>
                      <TD>{holiday.description}</TD>
                      <TD align="right">
                        <RemoveHolidayButton date={holiday.date} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        ) : null}
      </Page>
    </AppShell>
  );
}
