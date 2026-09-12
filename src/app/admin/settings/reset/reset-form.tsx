"use client";

import { useActionState } from "react";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import { Alert, FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { FormActions, FormGrid } from "@/components/ui/page";
import type { ResetRequestView } from "@/server/reset/service";
import { formatInstant } from "@/shared/format/date-time";

import { requestSystemResetAction } from "./actions";
import { emptyResetFormState } from "./form-state";

export function ResetForm({ lastRequest }: { lastRequest: ResetRequestView | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(
    requestSystemResetAction,
    emptyResetFormState,
  );

  const active =
    lastRequest?.status === "PENDING" || lastRequest?.status === "RUNNING";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title={t("screens.settingsForms.reset.title")}
          description={t("screens.settingsForms.reset.description")}
        />
        <CardBody className="flex flex-col gap-5">
          <Alert tone="danger" title={t("screens.settingsForms.reset.irreversibleTitle")}>
            {t("screens.settingsForms.reset.irreversibleDescription")}
          </Alert>

          <div className="grid gap-5 text-[length:var(--text-sm)] md:grid-cols-2">
            <div>
              <p className="font-semibold text-ink">{t("screens.settingsForms.reset.cleared")}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
                <li>{t("screens.settingsForms.reset.clearedUsers")}</li>
                <li>{t("screens.settingsForms.reset.clearedOrganization")}</li>
                <li>{t("screens.settingsForms.reset.clearedContent")}</li>
                <li>{t("screens.settingsForms.reset.clearedScores")}</li>
                <li>{t("screens.settingsForms.reset.clearedFiles")}</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-ink">{t("screens.settingsForms.reset.preserved")}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
                <li>{t("screens.settingsForms.reset.preservedCode")}</li>
                <li>{t("screens.settingsForms.reset.preservedSecrets")}</li>
                <li>{t("screens.settingsForms.reset.preservedBackups")}</li>
              </ul>
            </div>
          </div>

          <form action={formAction} className="flex flex-col gap-5 border-t border-line pt-5">
            <p className="section-label">{t("screens.settingsForms.reset.authentication")}</p>
            <Field
              htmlFor="currentPassword"
              label={t("screens.settingsForms.reset.currentPassword")}
              hint={t("screens.settingsForms.reset.currentPasswordHint")}
              required
            >
              <PasswordInput
                id="currentPassword"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
            </Field>

            <p className="section-label border-t border-line pt-5">
              {t("screens.settingsForms.reset.bootstrapTitle")}
            </p>
            <FormGrid>
              <Field htmlFor="bootstrapFullName" label={t("screens.settingsForms.reset.fullName")} required>
                <Input id="bootstrapFullName" name="bootstrapFullName" required autoComplete="name" />
              </Field>
              <Field
                htmlFor="bootstrapEmail"
                label={t("screens.settingsForms.reset.email")}
                hint={t("screens.settingsForms.reset.emailHint")}
                required
              >
                <Input id="bootstrapEmail" name="bootstrapEmail" type="email" required autoComplete="email" />
              </Field>
              <Field
                htmlFor="bootstrapPassword"
                label={t("screens.settingsForms.reset.initialPassword")}
                hint={t("screens.settingsForms.reset.passwordHint")}
                required
              >
                <PasswordInput
                  id="bootstrapPassword"
                  name="bootstrapPassword"
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field
                htmlFor="bootstrapPasswordRepeat"
                label={t("screens.settingsForms.reset.confirmPassword")}
                required
              >
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
              label={t("screens.settingsForms.reset.confirmation")}
              hint={t("screens.settingsForms.reset.confirmationHint")}
              required
            >
              <Input
                id="confirmation"
                name="confirmation"
                autoComplete="off"
                placeholder="RESET APPLICATION"
                required
              />
            </Field>

            <FormActions message={<FormMessage error={state.error} success={state.success} />}>
              <Button type="submit" variant="danger" disabled={pending || active}>
                {pending
                  ? t("screens.settingsForms.reset.createRequest")
                  : active
                    ? t("screens.settingsForms.reset.requestPending")
                    : t("screens.settingsForms.reset.submit")}
              </Button>
            </FormActions>
          </form>
        </CardBody>
      </Card>

      {lastRequest ? (
        <Card>
          <CardHeader title={t("screens.settingsForms.reset.lastOperation")} />
          <CardBody className="flex flex-col gap-2 text-[length:var(--text-sm)]">
            <p className="text-ink">
              <span className="font-semibold">{t("screens.settingsForms.reset.status")}</span>{" "}
              {t(`screens.settingsForms.reset.${lastRequest.status === "DONE" ? "completed" : lastRequest.status.toLowerCase()}`)}
            </p>
            <p className="text-muted">
              {t("screens.settingsForms.reset.requestTime")} {formatInstant(new Date(lastRequest.requestedAt), locale)}
            </p>
            <p className="text-muted">
              {t("screens.settingsForms.reset.newAdministrator")} {lastRequest.bootstrapFullName} · {lastRequest.bootstrapEmail}
            </p>
            {lastRequest.message ? (
              <p className="text-danger">
                {t("screens.settingsForms.reset.operationDetails", {
                  message: lastRequest.message,
                })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
