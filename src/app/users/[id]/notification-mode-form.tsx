"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { emptyNotificationModeState } from "./form-state";
import { saveNotificationModeAction } from "./notification-actions";


//



export type NotificationMode = "INSTANT" | "DAILY_DIGEST" | "ACTION_ONLY";

export function NotificationModeForm({ current }: { current: NotificationMode }) {
  const t = useTranslations();
  const options: {
    mode: NotificationMode;
    label: string;
    description: string;
  }[] = [
    {
      mode: "INSTANT",
      label: t("screens.profile.instant"),
      description: t("screens.profile.instantDescription"),
    },
    {
      mode: "DAILY_DIGEST",
      label: t("screens.profile.dailyDigest"),
      description: t("screens.profile.dailyDigestDescription"),
    },
    {
      mode: "ACTION_ONLY",
      label: t("screens.profile.actionOnly"),
      description: t("screens.profile.actionOnlyDescription"),
    },
  ];
  const [state, formAction, pending] = useActionState(
    saveNotificationModeAction,
    emptyNotificationModeState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3" data-test="notification-preference">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("screens.profile.notificationPreference")}</legend>

        {options.map((option) => (
          <label
            key={option.mode}
            className="flex cursor-pointer items-start gap-2.5 rounded-(--radius-sm) border border-line px-3 py-2.5 hover:bg-surface-hover has-checked:border-primary-line has-checked:bg-primary-soft/40"
          >
            <input
              type="radio"
              name="mode"
              value={option.mode}
              defaultChecked={current === option.mode}
              className="mt-0.5 size-4 border-line-strong text-primary"
            />
            <span className="min-w-0">
              <span className="block text-[length:var(--text-sm)] font-medium text-ink">
                {option.label}
              </span>
              <span className="block text-[length:var(--text-xs)] text-muted">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <FormMessage error={state.error} success={state.success} />

      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? t("screens.profile.saving") : t("screens.profile.savePreference")}
        </Button>
      </div>
    </form>
  );
}
