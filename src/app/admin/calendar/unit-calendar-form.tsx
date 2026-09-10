"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { saveUnitCalendarAction } from "./actions";
import { emptyCalendarFormState } from "./form-state";

// Birime özel mesai penceresi (Görev 11.9).
//
// **Devralınan değer açıkça gösteriliyor.** Bir birimin kendi tanımı yoksa
// hangi birimden devraldığı ve hangi saatleri kullandığı yazılıyor; kimse
// sürprizle karşılaşmasın.

const GUNLER = [
  { no: 1, ad: "Pzt" },
  { no: 2, ad: "Sal" },
  { no: 3, ad: "Çar" },
  { no: 4, ad: "Per" },
  { no: 5, ad: "Cum" },
  { no: 6, ad: "Cmt" },
  { no: 7, ad: "Paz" },
];

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

function kaynakMetni(satir: UnitCalendarRow): string {
  if (satir.source === "unit") return "Kendi tanımı";
  if (satir.source === "inherited") {
    return `${satir.sourceUnitName} biriminden devralındı`;
  }
  return "Şirket varsayılanından devralındı";
}

export function UnitCalendarForm({ units }: { units: UnitCalendarRow[] }) {
  const [state, formAction, pending] = useActionState(
    saveUnitCalendarAction,
    emptyCalendarFormState,
  );
  const [secili, setSecili] = useState(units[0]?.id ?? "");

  const satir = units.find((u) => u.id === secili) ?? units[0];
  if (!satir) return null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={2}>
        <Field htmlFor="unit-calendar-birim" label="Birim" required>
          <Select
            id="unit-calendar-birim"
            name="orgUnitId"
            value={secili}
            onChange={(event) => setSecili(event.target.value)}
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
            Şu an: <span className="text-ink">{kaynakMetni(satir)}</span> ·{" "}
            {satir.workStart}–{satir.workEnd}
            {satir.worksOnHolidays ? " · resmî tatilde çalışılır" : ""}
          </p>
        </div>
      </FormGrid>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">
          Birimin çalışma günleri
        </legend>
        <div className="flex flex-wrap gap-4">
          {GUNLER.map((gun) => (
            <Checkbox
              key={`${satir.id}-${gun.no}`}
              name={`day-${gun.no}`}
              label={gun.ad}
              defaultChecked={satir.workingDays.includes(gun.no)}
            />
          ))}
        </div>
      </fieldset>

      <FormGrid columns={3}>
        <Field htmlFor="unit-work-start" label="Birimin mesai başlangıcı" required>
          <Input
            key={`${satir.id}-bas`}
            id="unit-work-start"
            name="workStart"
            type="time"
            defaultValue={satir.workStart}
          />
        </Field>
        <Field htmlFor="unit-work-end" label="Birimin mesai bitişi" required>
          <Input
            key={`${satir.id}-bit`}
            id="unit-work-end"
            name="workEnd"
            type="time"
            defaultValue={satir.workEnd}
          />
        </Field>
        <div className="flex items-end">
          <Checkbox
            key={`${satir.id}-tatil`}
            name="worksOnHolidays"
            label="Resmî tatillerde çalışılır"
            defaultChecked={satir.worksOnHolidays}
          />
        </div>
      </FormGrid>

      <Checkbox
        key={`${satir.id}-devral`}
        name="inherit"
        label="Bu birimin kendi tanımını kaldır, üstünden devralsın"
      />

      <FormActions>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Birimi kaydet"}
        </Button>
      </FormActions>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </form>
  );
}
