"use client";

import { useActionState } from "react";

import type { Branding } from "@/server/settings/branding";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { removeLogoAction, saveBrandingAction } from "./actions";
import { emptySettingsFormState } from "./form-state";

// Kullanıcıya görünen uygulama adını ve görsel kimliğini düzenleme alanı.
//
// Logo yüklenmezse gezinme alanında sayfa başlığı yazılır.

export function BrandingForm({ branding }: { branding: Branding }) {
  const [state, formAction, pending] = useActionState(
    saveBrandingAction,
    emptySettingsFormState,
  );
  const [silState, silAction, silPending] = useActionState(
    async () => removeLogoAction(),
    emptySettingsFormState,
  );

  return (
    <Card>
      <CardHeader
        title="Görünüm ve sayfa metinleri"
        description="Gezinme alanında görünen logo, tarayıcı sekmesindeki başlık ve her sayfanın altındaki şerit metni."
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid>
            <Field
              htmlFor="pageTitle"
              label="Sayfa başlığı"
              hint="Tarayıcı sekmesinde görünür. Logonun alternatif metni de bundan gelir. Boş bırakılırsa varsayılan kullanılır."
            >
              <Input id="pageTitle"
                name="pageTitle"
                defaultValue={branding.pageTitle}
                maxLength={100}
              />
            </Field>

            <Field
              htmlFor="footerText"
              label="Alt şerit metni"
              hint="Her sayfanın altında görünen metin."
              className="sm:col-span-2"
            >
              <Input id="footerText"
                name="footerText"
                defaultValue={branding.footerText}
                maxLength={200}
              />
            </Field>

            <Field htmlFor="logo"
              label="Logo"
              hint="PNG, JPEG veya SVG · en fazla 512 KB · yüksekliği 40 piksele ölçeklenir"
            >
              <Input id="logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="file:mr-3 file:rounded file:border-0 file:bg-inset file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
              />
            </Field>
          </FormGrid>

          {branding.logoUrl ? (
            <div className="flex items-center gap-3 rounded-(--radius-sm) border border-line bg-inset px-3 py-2">
              <span className="text-xs font-medium text-muted">Şu anki logo</span>
              <div className="flex h-8 w-40 items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={branding.logoUrl}
                  alt="Yüklenmiş logo"
                  className="max-h-8 max-w-full object-contain object-left"
                />
              </div>
            </div>
          ) : null}

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              Kaydet
            </Button>
          </FormActions>
        </form>

        {branding.logoUrl ? (
          <form
            action={silAction}
            className="mt-3"
            onSubmit={(event) => {
              if (!window.confirm("Yüklenmiş logo kaldırılacak. Devam etmek istiyor musunuz?")) {
                event.preventDefault();
              }
            }}
          >
            <Button type="submit" size="sm" disabled={silPending}>
              Logoyu kaldır
            </Button>
            <div className="mt-2">
              <FormMessage error={silState.error} success={silState.success} />
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
