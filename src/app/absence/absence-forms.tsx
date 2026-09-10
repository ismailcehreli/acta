"use client";

import { useActionState, useState } from "react";

import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { cancelOwnAbsenceAction, markOwnAbsenceAction } from "./actions";
import { emptyAbsenceFormState } from "./form-state";

// Kişinin kendi dönemi (Görev 11.8). Kişi seçici **yok**: kayıt her zaman
// oturumdaki kişiye ait.

export function MarkOwnAbsenceForm({
  maxDays,
  deputyPeople = [],
}: {
  maxDays: number;
  deputyPeople?: { id: string; fullName: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    markOwnAbsenceAction,
    emptyAbsenceFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={3}>
        <Field htmlFor="own-start" label="Başlangıç" required>
          <Input id="own-start" name="startDate" type="date" required />
        </Field>

        <Field htmlFor="own-end" label="Bitiş" required>
          <Input id="own-end" name="endDate" type="date" required />
        </Field>

        <Field
          htmlFor="own-note"
          label="Not (isteğe bağlı)"
          hint="Örn. yıllık izin, rapor"
        >
          <Input id="own-note" name="note" maxLength={500} />
        </Field>

        {deputyPeople.length > 0 ? (
          <Field
            htmlFor="own-deputy"
            label="Vekil yönetici"
            hint="İzniniz sırasında departmanınızın taleplerini sizin yerinize karara bağlar."
          >
            <Select id="own-deputy" name="deputyId" defaultValue="">
              <option value="">Vekil seçmeden devam et</option>
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
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <span className="text-[length:var(--text-sm)] text-muted">
          En fazla {maxDays} gün. Daha uzun bir dönemi yöneticiniz girebilir.
          {deputyPeople.length > 0
            ? " İzniniz sırasında talepleri yönetmesi için vekil seçebilirsiniz."
            : ""}
        </span>
      </FormActions>

      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

export function CancelOwnAbsenceButton({ id }: { id: string }) {
  const [acik, setAcik] = useState(false);
  const [state, formAction, pending] = useActionState(
    cancelOwnAbsenceAction,
    emptyAbsenceFormState,
  );

  if (!acik) {
    return (
      <Button type="button" size="sm" onClick={() => setAcik(true)}>
        İptal et
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Field htmlFor={`iptal-${id}`} label="İptal gerekçesi" required>
        <Input
          id={`iptal-${id}`}
          name="reason"
          required
          maxLength={500}
          placeholder="Örn. tarihleri yanlış girdim"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "İptal ediliyor…" : "Kaydı iptal et"}
        </Button>
        <Button type="button" size="sm" onClick={() => setAcik(false)}>
          Vazgeç
        </Button>
      </div>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </form>
  );
}
