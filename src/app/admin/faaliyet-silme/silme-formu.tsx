"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";

import {
  faaliyetAraAction,
  kodGonderAction,
  silAction,
  type SilmeFormState,
} from "./actions";

// Silme akışının iki adımı (karar 03.09.2026): kod iste → kodu gir.
//
// Tek adımlı bir "Sil" düğmesi kasıtlı olarak yok. Kod, kazara silmeye karşı
// **bilinçli** bir engeldir: e-postayı açıp altı haneyi taşımak, kullanıcıyı
// ne yaptığını bir kez daha düşünmeye zorlar.

const BASLANGIC: SilmeFormState = {};

export function FaaliyetArama() {
  const [state, action, pending] = useActionState(faaliyetAraAction, BASLANGIC);

  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        htmlFor="activityId"
        label="Faaliyet kimliği ya da bağlantısı"
        hint="Kaydın adresini yapıştırabilirsiniz; kimlik otomatik ayıklanır."
      >
        <Input
          id="activityId"
          name="activityId"
          placeholder="/activities/… ya da kimlik"
          required
        />
      </Field>

      <FormActions
        message={state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Aranıyor…" : "Kaydı getir"}
        </Button>
      </FormActions>
    </form>
  );
}

export function SilmeAdimlari({
  activityId,
  silmeAcik,
}: {
  activityId: string;
  /** Dönem kapalıysa akış hiç başlamaz; buton da yoktur. */
  silmeAcik: boolean;
}) {
  const [kodState, kodAction, kodPending] = useActionState(
    kodGonderAction,
    BASLANGIC,
  );
  const [silState, silmeAction, silPending] = useActionState(silAction, BASLANGIC);

  if (!silmeAcik) return null;

  // Silme tamamlandıysa akış kapanır: ekranda artık kod alanı durmamalı.
  if (silState.success) {
    return (
      <Alert tone="success">{silState.success}</Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={kodAction}>
        <input type="hidden" name="activityId" value={activityId} />
        <FormActions
          message={
            kodState.error ? (
              <Alert tone="danger">{kodState.error}</Alert>
            ) : kodState.success ? (
              <Alert tone="success">{kodState.success}</Alert>
            ) : null
          }
        >
          <Button type="submit" variant="secondary" disabled={kodPending}>
            {kodPending ? "Gönderiliyor…" : "Silme kodu gönder"}
          </Button>
        </FormActions>
      </form>

      <form action={silmeAction} className="flex flex-col gap-3">
        <input type="hidden" name="activityId" value={activityId} />
        <Field
          htmlFor="code"
          label="E-postanıza gelen kod"
          hint="Altı hane, on dakika geçerli, bir kez kullanılır."
        >
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            required
          />
        </Field>

        <FormActions
          message={silState.error ? <Alert tone="danger">{silState.error}</Alert> : null}
        >
          <Button type="submit" variant="danger" disabled={silPending}>
            {silPending ? "Siliniyor…" : "Kaydı kalıcı olarak sil"}
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
