"use client";

import { useActionState, useState } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { saveUnitCalendarAction } from "./actions";
import { emptyCalendarFormState } from "./form-state";
const DAYS = [
  { no: 1, key: "monday" },
  { no: 2, key: "tuesday" },
  { no: 3, key: "wednesday" },
  { no: 4, key: "thursday" },
  { no: 5, key: "friday" },
  { no: 6, key: "saturday" },
  { no: 7, key: "sunday" },
] as const;

export interface UnitCalendarRow {
  id: string;
  label: string;
  workingDays: number[];
  workStart: string;
  workEnd: string;
  worksOnHolidays: boolean;
  source: "unit" | "inherited" | "company";
  sourceUnitName: string | null;
}

function sourceText(
  row: UnitCalendarRow,
  t: ReturnType<typeof useTranslations>,
): string {
  if (row.source === "unit") return t("screens.calendar.ownDefinition");
  if (row.source === "inherited") {
    return t("screens.calendar.inheritedFrom", {
      unit: row.sourceUnitName ?? "—",
    });
  }
  return t("screens.calendar.inheritedFromCompany");
}

export function UnitCalendarForm({ units }: { units: UnitCalendarRow[] }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    saveUnitCalendarAction,
    emptyCalendarFormState,
  );
  const [selected, setSelected] = useState(units[0]?.id ?? "");

  const row = units.find((u) => u.id === selected) ?? units[0];
  if (!row) return null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={2}>
        <Field htmlFor="unit-calendar-unit" label={t("screens.calendar.unit")} required>
          <Select
            id="unit-calendar-unit"
            name="orgUnitId"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <p className="text-[length:var(--text-sm)] text-muted">
            {t("screens.calendar.currentSource")} <span className="text-ink">{sourceText(row, t)}</span> ·{" "}
            {row.workStart}–{row.workEnd}
            {row.worksOnHolidays ? ` · ${t("screens.calendar.worksOnHolidays")}` : ""}
          </p>
        </div>
      </FormGrid>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">
          {t("screens.calendar.unitWorkDays")}
        </legend>
        <div className="flex flex-wrap gap-4">
          {DAYS.map((day) => (
            <Checkbox
              key={`${row.id}-${day.no}`}
              name={`day-${day.no}`}
              label={t(`screens.calendar.weekdays.${day.key}`).slice(0, 3)}
              defaultChecked={row.workingDays.includes(day.no)}
            />
          ))}
        </div>
      </fieldset>

      <FormGrid columns={3}>
        <Field htmlFor="unit-work-start" label={t("screens.calendar.unitWorkStart")} required>
          <Input
            key={`${row.id}-bas`}
            id="unit-work-start"
            name="workStart"
            type="time"
            defaultValue={row.workStart}
          />
        </Field>
        <Field htmlFor="unit-work-end" label={t("screens.calendar.unitWorkEnd")} required>
          <Input
            key={`${row.id}-bit`}
            id="unit-work-end"
            name="workEnd"
            type="time"
            defaultValue={row.workEnd}
          />
        </Field>
        <div className="flex items-end">
          <Checkbox
            key={`${row.id}-holiday`}
            name="worksOnHolidays"
            label={t("screens.calendar.worksOnHolidays")}
            defaultChecked={row.worksOnHolidays}
          />
        </div>
      </FormGrid>

      <Checkbox
        key={`${row.id}-devral`}
        name="inherit"
        label={t("screens.calendar.inheritDefinition")}
      />

      <FormActions>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("common.saving") : t("screens.calendar.saveCalendar")}
        </Button>
      </FormActions>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </form>
  );
}
