"use client";

import { useActionState, useState } from "react";

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

// Yalnız yöneticinin kendi departmanındaki yönetici olmayan çalışanlar seçilir.

export function MarkAbsenceForm({
  people,
  deputyPeople = [],
  personLabel = "Kişi",
  deputyRequired = false,
}: {
  people: { id: string; fullName: string }[];
  deputyPeople?: { id: string; fullName: string }[];
  personLabel?: string;
  deputyRequired?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    markAbsenceAction,
    emptyAbsenceFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={3}>
        <Field htmlFor="absence-kisi" label={personLabel} required>
          <Select id="absence-kisi" name="userId" required defaultValue="">
            <option value="" disabled>
              Kişi seçin
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <Field htmlFor="absence-baslangic" label="Başlangıç" required>
          <Input id="absence-baslangic" type="date" name="startDate" required />
        </Field>

        <Field htmlFor="absence-bitis" label="Bitiş" required>
          <Input id="absence-bitis" type="date" name="endDate" required />
        </Field>

        <Field
          htmlFor="absence-not"
          label="Not (isteğe bağlı)"
          className="sm:col-span-2"
        >
          <Input id="absence-not" type="text" name="note" maxLength={500} />
        </Field>

        {deputyPeople.length > 0 ? (
          <Field
            htmlFor="absence-vekil"
            label="Vekil yönetici"
            hint={
              deputyRequired
                ? "Bu kayıt bir yöneticinin yokluğunu ve onun yerine karar verecek yöneticiyi belirtir."
                : "Yalnız yöneticiler için vekil seçilebilir."
            }
            required={deputyRequired}
          >
            <Select
              id="absence-vekil"
              name="deputyId"
              defaultValue=""
              required={deputyRequired}
            >
              <option value="">
                {deputyRequired ? "Vekil yönetici seçin" : "Yok"}
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
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </FormActions>
    </form>
  );
}

/** Bekleyen çalışan talebi için iki adımlı karar alanı. */
export function AbsenceDecisionActions({ absence }: { absence: AbsenceView }) {
  const [state, formAction, pending] = useActionState(
    decideAbsenceAction,
    emptyAbsenceFormState,
  );
  const [reddetmeAcik, setReddetmeAcik] = useState(false);

  if (reddetmeAcik) {
    return (
      <form action={formAction} className="flex flex-wrap items-start gap-2">
        <input type="hidden" name="id" value={absence.id} />
        <input type="hidden" name="decision" value="REJECTED" />
        <Input
          name="reason"
          placeholder="Reddetme gerekçesi"
          aria-label="Reddetme gerekçesi"
          maxLength={500}
          required
          className="w-56"
        />
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Reddet"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setReddetmeAcik(false)}
        >
          Vazgeç
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
          {pending ? "Kaydediliyor…" : "Onayla"}
        </Button>
      </form>
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setReddetmeAcik(true)}
        disabled={pending}
      >
        Reddet
      </Button>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </div>
  );
}

/**
 * Kaydı iptal eder — silmez.
 *
 * Silme, vekilin o döneme ait görünürlüğünü de götürürdü (§4.5). Gerekçe
 * zorunlu: aylar sonra "bu dönem neden yok" sorusunun cevabı burada durur.
 * İki adımlı, çünkü tek tıkla geri alınamaz bir iş yapılmamalı.
 */
export function CancelAbsenceButton({ absence }: { absence: AbsenceView }) {
  const [state, formAction, pending] = useActionState(
    cancelAbsenceAction,
    emptyAbsenceFormState,
  );
  const [aciliyor, setAciliyor] = useState(false);

  if (!aciliyor) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setAciliyor(true)}
        aria-label={`${absence.userName} kaydını iptal et`}
      >
        İptal et
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={absence.id} />
      <Input
        name="reason"
        placeholder="İptal gerekçesi"
        aria-label="İptal gerekçesi"
        maxLength={500}
        required
        className="w-56"
      />
      <Button type="submit" size="sm" variant="danger" disabled={pending}>
        {pending ? "İptal ediliyor…" : "Onayla"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setAciliyor(false)}
      >
        Vazgeç
      </Button>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </form>
  );
}
