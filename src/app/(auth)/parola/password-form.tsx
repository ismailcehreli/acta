"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions } from "@/components/ui/page";

import { changePasswordAction } from "./actions";
import { emptyPasswordFormState } from "./form-state";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    emptyPasswordFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field htmlFor="currentPassword" label="Mevcut parola" required>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        htmlFor="newPassword"
        label="Yeni parola"
        hint="En az 10 karakter."
        required
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
        />
      </Field>

      <Field htmlFor="newPasswordRepeat" label="Yeni parola (tekrar)" required>
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
            <div id="parola-hatasi">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null
        }
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Değiştiriliyor…" : "Parolayı değiştir"}
        </Button>
      </FormActions>
    </form>
  );
}
