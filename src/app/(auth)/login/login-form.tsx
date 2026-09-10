"use client";

import { useActionState, useEffect, useRef } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";

import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { error: null };

export function LoginForm({ rememberDays = 0 }: { rememberDays?: number }) {
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
          <Alert tone="danger" title="Giriş yapılamadı">
            {state.error}
          </Alert>
        </div>
      ) : null}

      <Field htmlFor="email" label="E-posta" required>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="ad.soyad@sirket.com"
        />
      </Field>

      <Field htmlFor="password" label="Parola" required>
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
          label="Beni hatırla"
          description={`Bu tarayıcıda ${rememberDays} gün boyunca yeniden parola sorulmaz. Ortak bir bilgisayardaysanız işaretlemeyin.`}
        />
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className="w-full"
      >
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </Button>
    </form>
  );
}
