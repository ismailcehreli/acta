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
  const hata = useRef<HTMLDivElement>(null);

  // Hata çıkınca odak özete gider: klavye ve ekran okuyucu kullanıcısı
  // sonucu duymadan formu yeniden doldurmaya çalışmasın (§10).
  useEffect(() => {
    if (state.error) hata.current?.focus();
  }, [state.error]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error ? (
        <div id="giris-hatasi" ref={hata} tabIndex={-1}>
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

      {/* "Beni hatırla" yalnız oturumun **süresini** uzatır; başka hiçbir
          güvenlik kuralını gevşetmez. Kaç gün olduğu ekranda yazıyor:
          "hatırla" belirsiz bir söz, "30 gün" bir taahhüt. Sistem yöneticisi
          süreyi 0 yaparsa kutu hiç çizilmez — ortak bilgisayarların
          kullanıldığı yerlerde kapatılabilsin diye. */}
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
