"use client";

import Link from "next/link";
import { useActionState } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";

import { requestResetAction, resetPasswordAction } from "./actions";
import { emptyResetFormState } from "./form-state";

export function RequestResetForm() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    requestResetAction,
    emptyResetFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field htmlFor="email" label={t("common.email")} required>
        <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
      </Field>


      {state.info ? <Alert tone="success">{state.info}</Alert> : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className="w-full"
      >
        {pending ? t("common.saving") : t("auth.sendResetLink")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    emptyResetFormState,
  );


  if (state.info) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{state.info}</Alert>
        <Link
          href="/login"
          className="inline-flex min-h-(--spacing-control) items-center justify-center rounded-(--radius-sm) border border-line-strong px-4 text-[length:var(--text-sm)] font-medium text-ink hover:bg-surface-hover"
        >
          {t("auth.backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />


      <Field
        htmlFor="newPassword"
        label={t("auth.newPassword")}
        required
        hint={t("auth.passwordMinimumHint")}
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          autoFocus
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

      {state.error ? (
          <Alert tone="danger" title={t("auth.changePasswordError")}>
          {state.error}
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className="w-full"
      >
        {pending ? t("common.saving") : t("auth.changePassword")}
      </Button>
    </form>
  );
}
