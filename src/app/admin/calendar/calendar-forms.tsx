"use client";

import { useActionState } from "react";

import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import {
  minuteToTime,
  WEEKDAY_NAMES,
  type WorkCalendarInput,
} from "@/shared/schemas/calendar";

import {
  addHolidayAction,
  removeHolidayAction,
  saveWorkCalendarAction,
} from "./actions";
import { emptyCalendarFormState } from "./form-state";

// Çalışma takvimi ekranı (§12.1). Takvim şirket genelinde tektir; vardiya ve
// kişi bazlı takvim v3'te kaldırıldı, burada da yok.

export function WorkCalendarForm({ calendar }: { calendar: WorkCalendarInput }) {
  const [state, formAction, pending] = useActionState(
    saveWorkCalendarAction,
    emptyCalendarFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-[length:var(--text-sm)] font-medium text-ink">
          Çalışma günleri
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(WEEKDAY_NAMES).map(([value, name]) => (
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
              {name}
            </label>
          ))}
        </div>
      </fieldset>

      <FormGrid columns={2}>
        <Field htmlFor="takvim-baslangic" label="Mesai başlangıcı">
          <Input
            id="takvim-baslangic"
            type="time"
            name="workStart"
            defaultValue={minuteToTime(calendar.workStartMinute)}
          />
        </Field>
        <Field htmlFor="takvim-bitis" label="Mesai bitişi">
          <Input
            id="takvim-bitis"
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
          {pending ? "Kaydediliyor…" : "Takvimi kaydet"}
        </Button>
      </FormActions>
    </form>
  );
}

export function AddHolidayForm() {
  const [state, formAction, pending] = useActionState(
    addHolidayAction,
    emptyCalendarFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="tatil-tarih" label="Tarih" className="w-44" required>
          <Input id="tatil-tarih" type="date" name="date" required />
        </Field>
        <Field
          htmlFor="tatil-aciklama"
          label="Açıklama"
          className="min-w-64 flex-1"
          required
        >
          <Input
            id="tatil-aciklama"
            type="text"
            name="description"
            required
            maxLength={150}
            placeholder="Örn. Cumhuriyet Bayramı"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending}>
          Tatil ekle
        </Button>
      </div>

      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

export function RemoveHolidayButton({ date }: { date: string }) {
  const [state, formAction, pending] = useActionState(
    removeHolidayAction,
    emptyCalendarFormState,
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="date" value={date} />
      <Button type="submit" size="sm" variant="danger" disabled={pending}>
        Çıkar
      </Button>
      {state.error ? (
        <Alert tone="danger">
          {state.error}
        </Alert>
      ) : null}
    </form>
  );
}
