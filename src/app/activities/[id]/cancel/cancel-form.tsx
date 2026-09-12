"use client";

import { useActionState } from "react";

import { cancelActivityAction } from "@/app/activities/actions";
import { useTranslations } from "@/components/i18n/provider";
import { emptyActivityFormState } from "@/app/activities/form-state";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";

export function CancelForm({ activityId }: { activityId: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    cancelActivityAction,
    emptyActivityFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={activityId} />

      <Field
        htmlFor="reason"
        label={t("activities.cancelReason")}
        hint={t("activities.cancelReasonHint")}
        required
      >
        <Textarea id="reason" name="reason" required rows={4} />
      </Field>

      <FormActions
        message={
          state.error ? (
            <div id="cancellation-error">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null
        }
      >
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? t("activities.cancelling") : t("activities.cancelActivity")}
        </Button>
        <ButtonLink href={`/activities/${activityId}`}>{t("common.cancel")}</ButtonLink>
      </FormActions>
    </form>
  );
}
