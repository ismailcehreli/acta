"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";

import { saveVapidAction } from "./actions";
import { emptySettingsFormState } from "./form-state";


//




export interface PushView {
  configured: boolean;
  publicKey: string;
  subject: string;

  subscriberCount: number;
}

export function PushForm({ view }: { view: PushView }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    saveVapidAction,
    emptySettingsFormState,
  );

  return (
    <Card>
      <CardHeader
        title={t("screens.settingsForms.push.title")}
        description={t("screens.settingsForms.push.description")}
      />
      <CardBody>
        <form
          action={formAction}
          className="flex flex-col gap-4"
          data-test="push-setup"
        >
          <p className="text-[length:var(--text-sm)] text-muted">
            {view.configured
              ? t("screens.settingsForms.push.configured", {
                  count: view.subscriberCount,
                })
              : t("screens.settingsForms.push.notConfigured")}
          </p>

          <Field
            htmlFor="vapidSubject"
            label={t("screens.settingsForms.push.contactAddress")}
            hint={t("screens.settingsForms.push.contactHint")}
            required
          >
            <Input
              id="vapidSubject"
              name="subject"
              defaultValue={view.subject}
              placeholder="mailto:it@company.com"
              maxLength={200}
              required
            />
          </Field>

          {view.configured ? (
            // Regenerating keys invalidates every existing browser subscription,
            // so it is deliberately separate from saving the contact address.
            <div className="border-t border-line pt-4">
              <Checkbox
                name="replace"
                label={t("screens.settingsForms.push.replaceKeys")}
                description={t("screens.settingsForms.push.replaceKeysDescription")}
              />
            </div>
          ) : null}

          <FormMessage error={state.error} success={state.success} />

          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? t("screens.settingsForms.push.generating")
                : view.configured
                  ? t("screens.settingsForms.push.save")
                  : t("screens.settingsForms.push.generateAndConfigure")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
