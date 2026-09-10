"use client";

import { useActionState } from "react";

import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions, FormGrid } from "@/components/ui/page";
import type { ResetRequestView } from "@/server/reset/service";

import { requestSystemResetAction } from "./actions";
import { emptyResetFormState } from "./form-state";

const STATUS_LABELS: Record<ResetRequestView["status"], string> = {
  PENDING: "Bekliyor",
  RUNNING: "Çalışıyor",
  DONE: "Tamamlandı",
  FAILED: "Başarısız",
};

function tarihMetni(value: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function ResetForm({ lastRequest }: { lastRequest: ResetRequestView | null }) {
  const [state, formAction, pending] = useActionState(
    requestSystemResetAction,
    emptyResetFormState,
  );

  const aktif =
    lastRequest?.status === "PENDING" || lastRequest?.status === "RUNNING";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Başlangıca dönüş"
          description="Bu işlem uygulamadaki kullanıcıları ve iş kayıtlarını temizler; şema, sunucu ayarları ve alınmış yedekler korunur."
        />
        <CardBody className="flex flex-col gap-5">
          <Alert tone="danger" title="Geri alınamaz işlem">
            İşlem başlamadan önce otomatik bir yedek alınır. Yedek alınamazsa
            hiçbir veri silinmez. İşlem tamamlandığında mevcut oturumlar kapanır
            ve yalnız aşağıda belirlediğiniz başlangıç yöneticisi kalır.
          </Alert>

          <div className="grid gap-5 text-[length:var(--text-sm)] md:grid-cols-2">
            <div>
              <p className="font-semibold text-ink">Temizlenecekler</p>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
                <li>Kullanıcılar, parolalar ve oturumlar</li>
                <li>Organizasyon ağacı ve iş kayıtları</li>
                <li>İzin, bildirim, geri bildirim ve yardım içerikleri</li>
                <li>Skorlar ve uygulama ayarlarının özel değerleri</li>
                <li>Avatar, logo ve ek dosya depoları</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-ink">Korunacaklar</p>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
                <li>Uygulama kodu, şema ve migration geçmişi</li>
                <li>`.env` içindeki bağlantı ve sunucu sırları</li>
                <li>Daha önce alınmış şifreli yedekler</li>
              </ul>
            </div>
          </div>

          <form action={formAction} className="flex flex-col gap-5 border-t border-line pt-5">
            <p className="section-label">Kimlik doğrulama</p>
            <Field
              htmlFor="currentPassword"
              label="Mevcut parolanız"
              hint="Bu işlem yalnızca sistem yöneticisi hesabının gerçek sahibi tarafından başlatılabilir."
              required
            >
              <PasswordInput
                id="currentPassword"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
            </Field>

            <p className="section-label border-t border-line pt-5">Yeni başlangıç yöneticisi</p>
            <FormGrid>
              <Field htmlFor="bootstrapFullName" label="Ad soyad" required>
                <Input id="bootstrapFullName" name="bootstrapFullName" required autoComplete="name" />
              </Field>
              <Field
                htmlFor="bootstrapEmail"
                label="E-posta"
                hint="Yeni yönetici bu adresle giriş yapacak."
                required
              >
                <Input id="bootstrapEmail" name="bootstrapEmail" type="email" required autoComplete="email" />
              </Field>
              <Field htmlFor="bootstrapPassword" label="Başlangıç parolası" hint="En az 10 karakter." required>
                <PasswordInput
                  id="bootstrapPassword"
                  name="bootstrapPassword"
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field htmlFor="bootstrapPasswordRepeat" label="Başlangıç parolası (tekrar)" required>
                <PasswordInput
                  id="bootstrapPasswordRepeat"
                  name="bootstrapPasswordRepeat"
                  autoComplete="new-password"
                  required
                />
              </Field>
            </FormGrid>

            <Field
              htmlFor="confirmation"
              label="İşlemi onaylayın"
              hint="Başlatmak için BAŞLANGICA DÖN yazın."
              required
            >
              <Input
                id="confirmation"
                name="confirmation"
                autoComplete="off"
                placeholder="BAŞLANGICA DÖN"
                required
              />
            </Field>

            <FormActions message={<FormMessage error={state.error} success={state.success} />}>
              <Button type="submit" variant="danger" disabled={pending || aktif}>
                {pending ? "İstek oluşturuluyor…" : aktif ? "Başlangıca dönüş bekliyor" : "Başlangıca dön"}
              </Button>
            </FormActions>
          </form>
        </CardBody>
      </Card>

      {lastRequest ? (
        <Card>
          <CardHeader title="Son işlem" />
          <CardBody className="flex flex-col gap-2 text-[length:var(--text-sm)]">
            <p className="text-ink">
              <span className="font-semibold">Durum:</span> {STATUS_LABELS[lastRequest.status]}
            </p>
            <p className="text-muted">
              İstek zamanı: {tarihMetni(new Date(lastRequest.requestedAt))}
            </p>
            <p className="text-muted">
              Yeni yönetici: {lastRequest.bootstrapFullName} · {lastRequest.bootstrapEmail}
            </p>
            {lastRequest.message ? <p className="text-danger">{lastRequest.message}</p> : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
