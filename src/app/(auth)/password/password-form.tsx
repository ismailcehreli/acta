"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions } from "@/components/ui/page";

import { changePasswordAction } from "./actions";
import { emptyPasswordFormState } from "./form-state";

export function PasswordForm() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    emptyPasswordFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field htmlFor="currentPassword" label={t("auth.currentPassword")} required>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        htmlFor="newPassword"
        label={t("auth.newPassword")}
        hint={t("auth.passwordMinimumHint")}
        required
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
        />
      </Field>

      <Field htmlFor="newPasswordRepeat" label={t("auth.confirmPassword")} required>
        <PasswordInput
          id="newPasswordRepeat"
          name="newPasswordRepeat"
          autoComplete="new-password"
          required
        />
      </Field>

      <FormActions
        message={
          state.error ? (
            <div id="password-error">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null
        }
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("common.saving") : t("auth.changePassword")}
        </Button>
      </FormActions>
    </form>
  );
}
