import type { ReactNode } from "react";

import { Field, Input } from "@/components/ui/form";
import { getTranslations } from "@/server/i18n/server";

import { FilterBar } from "./filter-bar";


//




//



//



export interface FilterOptions {
  people: { id: string; fullName: string }[];
  departments: { id: string; name: string }[];
}

export interface FilterValues {
  period: string;
  authorId: string;
  authorOrgUnitId: string;
  targetOrgUnitId: string;
}

export const EMPTY_FILTERS: FilterValues = {
  period: "week",
  authorId: "",
  authorOrgUnitId: "",
  targetOrgUnitId: "",
};


export function isFiltered(
  selected: FilterValues,
  defaultPeriod = "week",
  unreadOnly = false,
): boolean {
  return (
    selected.authorId !== "" ||
    selected.authorOrgUnitId !== "" ||
    selected.targetOrgUnitId !== "" ||
    selected.period !== defaultPeriod ||
    unreadOnly
  );
}


export async function ActivityFilters({
  action,
  options,
  selected,
  clearHref,
  defaultPeriod = "week",
  unreadOnly = false,
  hidden,
  extra,
  pageSize,
  submitLabel,
}: {

  action?: string;
  options: FilterOptions;
  selected: FilterValues;
  clearHref: string;
  defaultPeriod?: string;

  hidden?: { name: string; value: string }[];

  extra?: ReactNode;

  unreadOnly?: boolean;

  pageSize?: number;

  submitLabel?: string;
}) {
  const t = await getTranslations();
  const departmentOptions = [
    { value: "", label: t("common.everyone") },
    ...options.departments.map((unit) => ({ value: unit.id, label: unit.name })),
  ];

  return (
    <FilterBar
      action={action}
      clearHref={clearHref}
      filtered={isFiltered(selected, defaultPeriod, unreadOnly)}
      hidden={hidden}
      extra={extra}
      pageSize={pageSize}
      submitLabel={submitLabel}
      fields={[
        {
          name: "period",
          label: t("common.period"),
          value: selected.period,
          width: "w-32",
          options: [
            { value: "today", label: t("dashboard.periodToday") },
            { value: "week", label: t("dashboard.periodWeek") },
            { value: "all", label: t("dashboard.periodAll") },
          ],
        },
        {
          name: "authorId",
          label: t("common.person"),
          value: selected.authorId,
          options: [
            { value: "", label: t("common.everyone") },
            ...options.people.map((person) => ({
              value: person.id,
              label: person.fullName,
            })),
          ],
        },
        {
          name: "authorOrgUnitId",
          label: t("common.authorDepartment"),
          value: selected.authorOrgUnitId,
          width: "w-52",
          options: departmentOptions,
        },
        {
          name: "targetOrgUnitId",
          label: t("common.relatedDepartment"),
          value: selected.targetOrgUnitId,
          width: "w-52",
          options: departmentOptions,
        },
      ]}
    />
  );
}


export async function SearchField({
  value,
  label,
  placeholder,
}: {
  value: string;

  label?: string;
  placeholder?: string;
}) {
  const t = await getTranslations();
  return (
    <Field htmlFor="q" label={label ?? t("common.search")} className="w-64">
      <Input
        key={value}
        id="q"
        name="q"
        type="search"
        defaultValue={value}
        placeholder={placeholder ?? t("screens.search.activityPlaceholder")}
      />
    </Field>
  );
}
