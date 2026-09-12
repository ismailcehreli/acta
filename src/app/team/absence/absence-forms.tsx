"use client";

import { useActionState, useState } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import type { AbsenceView } from "@/server/absence/service";

import {
  cancelAbsenceAction,
  decideAbsenceAction,
  markAbsenceAction,
} from "./actions";
import { emptyAbsenceFormState } from "./form-state";



export function MarkAbsenceForm({
  people,
  deputyPeople = [],
  personLabel,
  deputyRequired = false,
}: {
  people: { id: string; fullName: string }[];
  deputyPeople?: { id: string; fullName: string }[];
  personLabel?: string;
  deputyRequired?: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    markAbsenceAction,
    emptyAbsenceFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={3}>
        <Field htmlFor="absence-person" label={personLabel ?? t("screens.teamAbsence.person")} required>
          <Select id="absence-person" name="userId" required defaultValue="">
            <option value="" disabled>
              {t("screens.teamAbsence.selectPerson")}
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <Field htmlFor="absence-start" label={t("screens.absence.start")} required>
          <Input id="absence-start" type="date" name="startDate" required />
        </Field>

        <Field htmlFor="absence-end" label={t("screens.absence.end")} required>
          <Input id="absence-end" type="date" name="endDate" required />
        </Field>

        <Field
          htmlFor="absence-note"
          label={t("screens.absence.noteOptional")}
          className="sm:col-span-2"
        >
          <Input id="absence-note" type="text" name="note" maxLength={500} />
        </Field>

        {deputyPeople.length > 0 ? (
          <Field
            htmlFor="absence-deputy"
            label={t("screens.absence.deputyManager")}
            hint={
              deputyRequired
                ? t("screens.teamAbsence.personHint")
                : t("screens.teamAbsence.managerOnlyDeputyHint")
            }
            required={deputyRequired}
          >
            <Select
              id="absence-deputy"
              name="deputyId"
              defaultValue=""
              required={deputyRequired}
            >
              <option value="">
                {deputyRequired ? t("screens.teamAbsence.selectDeputy") : t("screens.teamAbsence.noDeputy")}
              </option>
              {deputyPeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

      </FormGrid>

      <FormActions
        message={<FormMessage error={state.error} success={state.success} />}
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("screens.absence.saving") : t("screens.absence.save")}
        </Button>
      </FormActions>
    </form>
  );
}


export function AbsenceDecisionActions({ absence }: { absence: AbsenceView }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    decideAbsenceAction,
    emptyAbsenceFormState,
  );
  const [rejectionOpen, setRejectionOpen] = useState(false);

  if (rejectionOpen) {
    return (
      <form action={formAction} className="flex flex-wrap items-start gap-2">
        <input type="hidden" name="id" value={absence.id} />
        <input type="hidden" name="decision" value="REJECTED" />
        <Input
          name="reason"
          placeholder={t("screens.teamAbsence.rejectionPlaceholder")}
          aria-label={t("screens.teamAbsence.rejectionPlaceholder")}
          maxLength={500}
          required
          className="w-56"
        />
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? t("screens.absence.saving") : t("screens.teamAbsence.reject")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setRejectionOpen(false)}
        >
          {t("screens.absence.cancel")}
        </Button>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={absence.id} />
        <input type="hidden" name="decision" value="APPROVED" />
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? t("screens.absence.saving") : t("screens.teamAbsence.approve")}
        </Button>
      </form>
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setRejectionOpen(true)}
        disabled={pending}
      >
        {t("screens.teamAbsence.reject")}
      </Button>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </div>
  );
}


export function CancelAbsenceButton({ absence }: { absence: AbsenceView }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    cancelAbsenceAction,
    emptyAbsenceFormState,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setOpen(true)}
        aria-label={`${absence.userName} ${t("screens.teamAbsence.cancelButton")}`}
      >
        {t("screens.teamAbsence.cancelButton")}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={absence.id} />
      <Input
        name="reason"
        placeholder={t("screens.teamAbsence.cancelPlaceholder")}
        aria-label={t("screens.teamAbsence.cancelPlaceholder")}
        maxLength={500}
        required
        className="w-56"
      />
      <Button type="submit" size="sm" variant="danger" disabled={pending}>
        {pending ? t("screens.teamAbsence.cancelling") : t("screens.teamAbsence.cancelRecord")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(false)}
      >
        {t("screens.absence.cancel")}
      </Button>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </form>
  );
}
