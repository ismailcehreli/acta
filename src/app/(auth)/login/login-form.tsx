"use client";

import { useActionState, useEffect, useRef } from "react";

import { useTranslations } from "@/components/i18n";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";

import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { error: null };

export function LoginForm({ rememberDays = 0 }: { rememberDays?: number }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const error = useRef<HTMLDivElement>(null);



  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state.error]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <div id="login-error" ref={error} tabIndex={-1}>
          <Alert tone="danger" title={t("auth.loginFailed")}>
            {state.error}
          </Alert>
        </div>
      ) : null}

      <Field htmlFor="email" label={t("common.email")} required>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          autoFocus
          placeholder={t("auth.emailPlaceholder")}
        />
      </Field>

      <Field htmlFor="password" label={t("auth.passwordLabel")} required>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </Field>


      {rememberDays > 0 ? (
        <Checkbox
          name="remember"
          label={t("auth.rememberMe")}
          description={t("auth.rememberMeDesc", { days: rememberDays })}
        />
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className="w-full"
      >
        {pending ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
  );
}
