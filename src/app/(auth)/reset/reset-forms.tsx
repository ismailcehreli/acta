"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";

import { requestResetAction, resetPasswordAction } from "./actions";
import { emptyResetFormState } from "./form-state";

export function RequestResetForm() {
  const [state, formAction, pending] = useActionState(
    requestResetAction,
    emptyResetFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field htmlFor="email" label="E-posta" required>
        <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
      </Field>

      {/* Hesabın var olup olmadığını ele vermeyen güvenli mesaj (§7). */}
      {state.info ? <Alert tone="success">{state.info}</Alert> : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className="w-full"
      >
        {pending ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    emptyResetFormState,
  );

  // Parola değiştiyse form kalkar: aynı bağlantı ikinci kez çalışmaz.
  if (state.info) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{state.info}</Alert>
        <Link
          href="/login"
          className="inline-flex min-h-(--spacing-control) items-center justify-center rounded-(--radius-sm) border border-line-strong px-4 text-[length:var(--text-sm)] font-medium text-ink hover:bg-surface-hover"
        >
          Giriş ekranına git
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {/* Parola kuralı **girmeden önce** görünür ve yalnız renkle değil
          metinle anlatılır (§7). */}
      <Field
        htmlFor="newPassword"
        label="Yeni parola"
        required
        hint="En az 10 karakter. Kolay tahmin edilen bir şey seçmeyin."
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          autoFocus
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

      {state.error ? (
        <Alert tone="danger" title="Parola değiştirilemedi">
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
        {pending ? "Değiştiriliyor…" : "Parolayı değiştir"}
      </Button>
    </form>
  );
}
