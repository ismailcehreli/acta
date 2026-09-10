"use client";

import { useActionState } from "react";

import type { SmtpView } from "@/server/settings/smtp";
import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import {
  clearSmtpPasswordAction,
  saveSmtpAction,
  sendTestEmailAction,
} from "./actions";
import { emptySettingsFormState } from "./form-state";

// SMTP ayarları (§12.3). Parola ekranda **hiç gösterilmez**; boş bırakılırsa
// kayıtlı olan korunur.

export function SmtpForm({ view }: { view: SmtpView }) {
  const [state, formAction, pending] = useActionState(
    saveSmtpAction,
    emptySettingsFormState,
  );
  const [silState, silAction, silPending] = useActionState(
    async () => clearSmtpPasswordAction(),
    emptySettingsFormState,
  );
  const [testState, testAction, testPending] = useActionState(
    sendTestEmailAction,
    emptySettingsFormState,
  );

  return (
    <Card>
      <CardHeader
        title="E-posta gönderimi (SMTP)"
        description="Bildirimler bu sunucu üzerinden gider. Ayar yoksa kuyrukta birikir."
      />
      <CardBody className="flex flex-col gap-5">
        {view.source === "environment" ? (
          <Alert tone="info">
            Ayarlar şu anda ortam değişkenlerinden geliyor. Buradan
            kaydettiğinizde veritabanındaki değerler geçerli olur.
          </Alert>
        ) : view.source === "none" ? (
          <Alert tone="correction">
            SMTP ayarlı değil: bildirimler kuyrukta birikir ve gönderilmez.
          </Alert>
        ) : null}

        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid>
            <Field htmlFor="host" label="Sunucu adresi" required>
              <Input id="host" name="host" defaultValue={view.host} required />
            </Field>

            <Field htmlFor="port" label="Port">
              <Input id="port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={view.port}
                className="w-32 tabular"
              />
            </Field>

            <Field htmlFor="user" label="Kullanıcı adı">
              <Input id="user" name="user" defaultValue={view.user} autoComplete="off" />
            </Field>

            <Field htmlFor="password"
              label="Parola"
              hint={
                view.hasPassword
                  ? "Kayıtlı. Değiştirmiyorsanız boş bırakın."
                  : "Kayıtlı değil."
              }
            >
              <Input id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder={view.hasPassword ? "••••••••" : ""}
              />
            </Field>
          </FormGrid>

          <Field htmlFor="from"
            label="Gönderen adresi"
            required
            hint="Örnek: Faaliyet Raporlama <faaliyet@sirket.test>"
          >
            <Input id="from" name="from" defaultValue={view.from} required />
          </Field>

          <Checkbox
            name="secure"
            defaultChecked={view.secure}
            label="Bağlantı TLS ile şifreli"
            description="Genellikle 465 portu için işaretlenir."
          />

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              SMTP ayarlarını kaydet
            </Button>

            {view.hasPassword ? null : null}
          </FormActions>
        </form>

        {view.hasPassword ? (
          <form action={silAction}>
            <Button type="submit" size="sm" disabled={silPending}>
              Kayıtlı parolayı sil
            </Button>
            <div className="mt-2">
              <FormMessage error={silState.error} success={silState.success} />
            </div>
          </form>
        ) : null}

        <div className="border-t border-line pt-5">
          <p className="text-sm font-medium text-ink">Sınama e-postası</p>
          <p className="mt-0.5 text-sm text-muted">
            Yanlış bir sunucu adresi yüzünden bildirimlerin sessizce birikmesi,
            fark edilmesi en zor arızalardan biridir. Kaydettikten sonra deneyin.
          </p>

          <form action={testAction} className="mt-3 flex flex-wrap items-end gap-3">
            <Field htmlFor="to" label="Alıcı adresi" className="min-w-64 flex-1">
              <Input id="to" name="to" type="email" required placeholder="deneme@sirket.test" />
            </Field>
            <Button type="submit" disabled={testPending}>
              Gönder
            </Button>
            <div className="w-full">
              <FormMessage error={testState.error} success={testState.success} />
            </div>
          </form>
        </div>
      </CardBody>
    </Card>
  );
}
