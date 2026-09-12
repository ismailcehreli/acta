"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import type { Branding } from "@/server/settings/branding";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { removeLogoAction, saveBrandingAction } from "./actions";
import { emptySettingsFormState } from "./form-state";


//


export function BrandingForm({ branding }: { branding: Branding }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    saveBrandingAction,
    emptySettingsFormState,
  );
  const [deletionState, deleteAction, deletePending] = useActionState(
    async () => removeLogoAction(),
    emptySettingsFormState,
  );

  return (
    <Card>
      <CardHeader
        title={t("screens.settingsForms.branding.title")}
        description={t("screens.settingsForms.branding.description")}
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid>
            <Field
              htmlFor="pageTitle"
              label={t("screens.settingsForms.branding.pageTitle")}
              hint={t("screens.settingsForms.branding.pageTitleHint")}
            >
              <Input id="pageTitle"
                name="pageTitle"
                defaultValue={branding.pageTitle}
                maxLength={100}
              />
            </Field>

            <Field
              htmlFor="footerText"
              label={t("screens.settingsForms.branding.footerText")}
              hint={t("screens.settingsForms.branding.footerHint")}
              className="sm:col-span-2"
            >
              <Input id="footerText"
                name="footerText"
                defaultValue={branding.footerText}
                maxLength={200}
              />
            </Field>

            <Field htmlFor="logo"
              label={t("screens.settingsForms.branding.logo")}
              hint={t("screens.settingsForms.branding.logoHint")}
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
              <span className="text-xs font-medium text-muted">
                {t("screens.settingsForms.branding.currentLogo")}
              </span>
              <div className="flex h-8 w-40 items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={branding.logoUrl}
                  alt={t("screens.settingsForms.branding.uploadedLogoAlt")}
                  className="max-h-8 max-w-full object-contain object-left"
                />
              </div>
            </div>
          ) : null}

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("screens.settingsForms.branding.save")}
            </Button>
          </FormActions>
        </form>

        {branding.logoUrl ? (
          <form
            action={deleteAction}
            className="mt-3"
            onSubmit={(event) => {
              if (!window.confirm(t("screens.settingsForms.branding.removeLogoConfirm"))) {
                event.preventDefault();
              }
            }}
          >
            <Button type="submit" size="sm" disabled={deletePending}>
              {t("screens.settingsForms.branding.removeLogo")}
            </Button>
            <div className="mt-2">
              <FormMessage error={deletionState.error} success={deletionState.success} />
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
