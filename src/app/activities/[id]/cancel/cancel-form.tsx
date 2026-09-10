"use client";

import { useActionState } from "react";

import { cancelActivityAction } from "@/app/activities/actions";
import { emptyActivityFormState } from "@/app/activities/form-state";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";

export function CancelForm({ activityId }: { activityId: string }) {
  const [state, formAction, pending] = useActionState(
    cancelActivityAction,
    emptyActivityFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={activityId} />

      <Field
        htmlFor="reason"
        label="İptal gerekçesi"
        hint="Gerekçe kayıtta saklanır ve faaliyeti görenlere gösterilir."
        required
      >
        <Textarea id="reason" name="reason" required rows={4} />
      </Field>

      <FormActions
        message={
          state.error ? (
            <div id="iptal-hatasi">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null
        }
      >
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "İptal ediliyor…" : "Faaliyeti iptal et"}
        </Button>
        <ButtonLink href={`/activities/${activityId}`}>Vazgeç</ButtonLink>
      </FormActions>
    </form>
  );
}
