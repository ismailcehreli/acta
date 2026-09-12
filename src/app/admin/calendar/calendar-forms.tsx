"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import {
  minuteToTime,
  type WorkCalendarInput,
} from "@/shared/schemas/calendar";

import {
  addHolidayAction,
  removeHolidayAction,
  saveWorkCalendarAction,
} from "./actions";
import { emptyCalendarFormState } from "./form-state";
export function WorkCalendarForm({ calendar }: { calendar: WorkCalendarInput }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    saveWorkCalendarAction,
    emptyCalendarFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-[length:var(--text-sm)] font-medium text-ink">
          {t("screens.calendar.workDays")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries({
            1: "monday",
            2: "tuesday",
            3: "wednesday",
            4: "thursday",
            5: "friday",
            6: "saturday",
            7: "sunday",
          }).map(([value, key]) => (
            <label
              key={value}
              className="flex items-center gap-2 rounded-(--radius-sm) border border-line px-2.5 py-1.5 text-[length:var(--text-sm)] hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                name="workingDays"
                value={value}
                defaultChecked={calendar.workingDays.includes(Number(value))}
                className="size-4 rounded border-line-strong text-primary"
              />
              {t(`screens.calendar.weekdays.${key}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <FormGrid columns={2}>
        <Field htmlFor="work-calendar-start" label={t("screens.calendar.workStart")}>
          <Input
            id="work-calendar-start"
            type="time"
            name="workStart"
            defaultValue={minuteToTime(calendar.workStartMinute)}
          />
        </Field>
        <Field htmlFor="work-calendar-end" label={t("screens.calendar.workEnd")}>
          <Input
            id="work-calendar-end"
            type="time"
            name="workEnd"
            defaultValue={minuteToTime(calendar.workEndMinute)}
          />
        </Field>
      </FormGrid>

      <FormActions
        message={<FormMessage error={state.error} success={state.success} />}
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("common.saving") : t("screens.calendar.saveCalendar")}
        </Button>
      </FormActions>
    </form>
  );
}

export function AddHolidayForm() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    addHolidayAction,
    emptyCalendarFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="holiday-date" label={t("common.date")} className="w-44" required>
          <Input id="holiday-date" type="date" name="date" required />
        </Field>
        <Field
          htmlFor="holiday-description"
          label={t("screens.calendar.holidayDescriptionLabel")}
          className="min-w-64 flex-1"
          required
        >
          <Input
            id="holiday-description"
            type="text"
            name="description"
            required
            maxLength={150}
            placeholder={t("screens.calendar.holidayPlaceholder")}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending}>
          {t("screens.calendar.addHoliday")}
        </Button>
      </div>

      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

export function RemoveHolidayButton({ date }: { date: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    removeHolidayAction,
    emptyCalendarFormState,
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="date" value={date} />
      <Button type="submit" size="sm" variant="danger" disabled={pending}>
        {t("screens.calendar.removeHoliday")}
      </Button>
      {state.error ? (
        <Alert tone="danger">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
