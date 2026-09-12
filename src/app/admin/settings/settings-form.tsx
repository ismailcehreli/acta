"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "@/components/i18n";
import type { TranslateFunction } from "@/shared/i18n";

import {
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  type SettingDefinition,
} from "@/server/settings/registry";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";
import { ScorePolicy } from "@/components/scoring/score-policy";

import { saveSettingsAction } from "./actions";
import { emptySettingsFormState } from "./form-state";
import type { SettingsSectionSlug } from "./settings-sections";


function SettingRow({
  definition,
  value,
  t,
}: {
  definition: SettingDefinition;
  value: string;
  t: TranslateFunction;
}) {
  const label = translatedSettingText(
    t,
    definition.labelKey,
    definition.label,
  );
  const description = translatedSettingText(
    t,
    definition.descriptionKey,
    definition.description,
  );
  const placeholder = definition.placeholderKey
    ? translatedSettingText(t, definition.placeholderKey, definition.placeholder)
    : definition.placeholder;
  const unit = definition.unitKey
    ? translatedSettingText(t, definition.unitKey, definition.unit)
    : definition.unit;

  if (definition.type === "boolean") {
    return (
      <div className="py-3.5">
        <Checkbox
          name={definition.key}
          defaultChecked={value === "true"}
          label={label}
          description={description}
        />
      </div>
    );
  }

  if (definition.type === "domains") {
    return (
      <div className="flex flex-col gap-2 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        <Input
          type="text"
          name={definition.key}
          defaultValue={value}
          placeholder={placeholder}
          aria-label={label}
          className="w-full"
        />
      </div>
    );
  }

  if (definition.type === "select") {
    return (
      <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 sm:max-w-xl">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        <Select
          name={definition.key}
          defaultValue={value}
          aria-label={label}
          className="w-full shrink-0 sm:w-56"
        >
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.labelKey
                ? translatedSettingText(t, option.labelKey, option.label)
                : option.label}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:max-w-xl">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Input
          type="number"
          name={definition.key}
          defaultValue={value}
          min={definition.min}
          max={definition.max}
          step={1}
          aria-label={label}
          className="w-28 text-right tabular"
        />
        {unit ? (
          <span className="w-16 text-sm text-muted">{unit}</span>
        ) : (
          <span className="w-16" />
        )}
      </div>
    </div>
  );
}

function translatedSettingText(
  t: TranslateFunction,
  key: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (!key) return fallback;
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function SettingsForm({
  values,
  section,
}: {
  values: Record<string, string>;
  section: SettingsSectionSlug;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    saveSettingsAction,
    emptySettingsFormState,
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="section" value={section} />
      {SETTING_GROUPS.filter((group) =>
        SETTING_DEFINITIONS.some(
          (definition) =>
            definition.group === group &&
            definitionGroupBelongsToSection(definition.group, section),
        ),
      ).map((group) => {
        const fields = SETTING_DEFINITIONS.filter(
          (definition) =>
            definition.group === group &&
            definitionGroupBelongsToSection(definition.group, section),
        );
        if (fields.length === 0) return null;

        return (
          <Card
            key={group}
            id={
              group === "Approval flow"
                  ? "settings-approval-flow"
                : group === "Questions and answers"
                  ? "settings-questions-answers"
                  : group === "Follow-up items"
                  ? "settings-follow-up-items"
                    : undefined
            }
          >
            <CardHeader title={groupLabel(group, t)} />
            <CardBody className="divide-y divide-line py-0">
              {fields.map((definition) => (
                <SettingRow
                  key={definition.key}
                  definition={definition}
                  value={values[definition.key] ?? definition.defaultValue}
                  t={t}
                />
              ))}
              {group === "Score" ? <ScorePolicy values={values} /> : null}
            </CardBody>
          </Card>
        );
      })}

      <FormActions
        message={
          state.error || state.success || dirty ? (
            <div className="flex flex-col gap-2">
              <FormMessage error={state.error} success={state.success} />
              {dirty ? (
                <p className="text-[length:var(--text-xs)] text-muted" role="status">
                  {t("screens.settingsPage.unsavedChanges")}
                </p>
              ) : null}
            </div>
          ) : undefined
        }
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {t("screens.settingsPage.save")}
        </Button>
      </FormActions>
    </form>
  );
}

function groupLabel(
  group: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const keys: Record<string, string> = {
    "Activity entry": "screens.settingsPage.groups.activityEntry",
    "Approval flow": "screens.settingsPage.groups.approvalFlow",
    "Questions and answers": "screens.settingsPage.groups.questionsAnswers",
    "Follow-up items": "screens.settingsPage.groups.followUpItems",
    "Leave and no-activity days": "screens.settingsPage.groups.leaveDays",
    Notifications: "screens.settingsPage.groups.notifications",
    "File attachments": "screens.settingsPage.groups.fileAttachments",
    "User accounts": "screens.settingsPage.groups.userAccounts",
    Score: "screens.settingsPage.groups.score",
    "Sessions and security": "screens.settingsPage.groups.sessionsSecurity",
  };
  return t(keys[group] ?? group);
}

function definitionGroupBelongsToSection(
  group: string,
  section: SettingsSectionSlug,
): boolean {
  switch (section) {
    case "general":
      return group === "Activity entry" || group === "Leave and no-activity days";
    case "approval":
      return (
        group === "Approval flow" ||
        group === "Questions and answers" ||
        group === "Follow-up items"
      );
    case "notifications":
      return group === "Notifications";
    case "scoring":
      return group === "Score";
    case "accounts":
      return group === "User accounts" || group === "Sessions and security";
    case "files":
      return group === "File attachments";
    default:
      return false;
  }
}
