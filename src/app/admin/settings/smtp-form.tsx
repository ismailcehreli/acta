"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n/provider";
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




export function SmtpForm({ view }: { view: SmtpView }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    saveSmtpAction,
    emptySettingsFormState,
  );
  const [deletionState, deleteAction, deletePending] = useActionState(
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
        title={t("screens.settingsForms.smtp.title")}
        description={t("screens.settingsForms.smtp.description")}
      />
      <CardBody className="flex flex-col gap-5">
        {view.source === "environment" ? (
          <Alert tone="info">
            {t("screens.settingsForms.smtp.environmentNotice")}
          </Alert>
        ) : view.source === "none" ? (
          <Alert tone="correction">
            {t("screens.settingsForms.smtp.notConfiguredNotice")}
          </Alert>
        ) : null}

        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid>
            <Field htmlFor="host" label={t("screens.settingsForms.smtp.host")} required>
              <Input id="host" name="host" defaultValue={view.host} required />
            </Field>

            <Field htmlFor="port" label={t("screens.settingsForms.smtp.port")}>
              <Input id="port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={view.port}
                className="w-32 tabular"
              />
            </Field>

            <Field htmlFor="user" label={t("screens.settingsForms.smtp.username")}>
              <Input id="user" name="user" defaultValue={view.user} autoComplete="off" />
            </Field>

            <Field htmlFor="password"
              label={t("screens.settingsForms.smtp.password")}
              hint={
                view.hasPassword
                  ? t("screens.settingsForms.smtp.passwordSetHint")
                  : t("screens.settingsForms.smtp.passwordUnsetHint")
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
            label={t("screens.settingsForms.smtp.fromAddress")}
            required
            hint={t("screens.settingsForms.smtp.fromHint")}
          >
            <Input id="from" name="from" defaultValue={view.from} required />
          </Field>

          <Checkbox
            name="secure"
            defaultChecked={view.secure}
            label={t("screens.settingsForms.smtp.tls")}
            description={t("screens.settingsForms.smtp.tlsHint")}
          />

          <FormActions message={<FormMessage error={state.error} success={state.success} />}>
            <Button type="submit" variant="primary" disabled={pending}>
              {t("screens.settingsForms.smtp.save")}
            </Button>

            {view.hasPassword ? null : null}
          </FormActions>
        </form>

        {view.hasPassword ? (
          <form action={deleteAction}>
            <Button type="submit" size="sm" disabled={deletePending}>
              {t("screens.settingsForms.smtp.removePassword")}
            </Button>
            <div className="mt-2">
              <FormMessage error={deletionState.error} success={deletionState.success} />
            </div>
          </form>
        ) : null}

        <div className="border-t border-line pt-5">
          <p className="text-sm font-medium text-ink">
            {t("screens.settingsForms.smtp.testTitle")}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {t("screens.settingsForms.smtp.testDescription")}
          </p>

          <form action={testAction} className="mt-3 flex flex-wrap items-end gap-3">
            <Field
              htmlFor="to"
              label={t("screens.settingsForms.smtp.recipient")}
              className="min-w-64 flex-1"
            >
              <Input id="to" name="to" type="email" required placeholder="test@company.test" />
            </Field>
            <Button type="submit" disabled={testPending}>
              {t("screens.settingsForms.smtp.sendTest")}
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
