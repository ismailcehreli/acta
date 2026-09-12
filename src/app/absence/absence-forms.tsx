"use client";

import { useActionState, useState } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { cancelOwnAbsenceAction, markOwnAbsenceAction } from "./actions";
import { emptyAbsenceFormState } from "./form-state";
export function MarkOwnAbsenceForm({
  maxDays,
  deputyPeople = [],
}: {
  maxDays: number;
  deputyPeople?: { id: string; fullName: string }[];
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    markOwnAbsenceAction,
    emptyAbsenceFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={3}>
        <Field htmlFor="own-start" label={t("screens.absence.start")} required>
          <Input id="own-start" name="startDate" type="date" required />
        </Field>

        <Field htmlFor="own-end" label={t("screens.absence.end")} required>
          <Input id="own-end" name="endDate" type="date" required />
        </Field>

        <Field
          htmlFor="own-note"
          label={t("screens.absence.noteOptional")}
          hint={t("screens.absence.notePlaceholder")}
        >
          <Input id="own-note" name="note" maxLength={500} />
        </Field>

        {deputyPeople.length > 0 ? (
          <Field
            htmlFor="own-deputy"
            label={t("screens.absence.deputyManager")}
            hint={t("screens.absence.deputyHint")}
          >
            <Select id="own-deputy" name="deputyId" defaultValue="">
              <option value="">{t("screens.absence.noDeputy")}</option>
              {deputyPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </FormGrid>

      <FormActions>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("screens.absence.saving") : t("screens.absence.save")}
        </Button>
        <span className="text-[length:var(--text-sm)] text-muted">
          {t("screens.absence.maxDaysHint", { days: maxDays })}
          {deputyPeople.length > 0
            ? ` ${t("screens.absence.deputyChoiceHint")}`
            : ""}
        </span>
      </FormActions>

      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

export function CancelOwnAbsenceButton({ id }: { id: string }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    cancelOwnAbsenceAction,
    emptyAbsenceFormState,
  );

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        {t("screens.absence.cancel")}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Field htmlFor={`cancel-${id}`} label={t("screens.absence.cancellationReason")} required>
        <Input
          id={`cancel-${id}`}
          name="reason"
          required
          maxLength={500}
          placeholder={t("screens.absence.cancellationPlaceholder")}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? t("screens.absence.cancelling") : t("screens.absence.cancelRecord")}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          {t("screens.absence.cancel")}
        </Button>
      </div>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </form>
  );
}
