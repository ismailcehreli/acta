"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import {
  AttachmentPicker,
  type AttachmentPickerItem,
} from "@/components/activities/attachment-picker";
import type { TargetOption } from "@/server/activities/target-options";
import { MAX_TARGET_DEPARTMENTS } from "@/shared/schemas/activity";

import { useActivityDraft } from "@/components/forms/use-activity-draft";
import { useServerDraft } from "@/components/forms/use-server-draft";
import { DepartmentPicker } from "./department-picker";
import { savedAtLabel } from "@/shared/drafts/activity-draft";

import { saveDraftAction } from "@/app/drafts/actions";
import { emptyDraftState } from "@/app/drafts/form-state";
import { useLocale, useTranslations } from "@/components/i18n/provider";

import { createActivityAction, updateActivityAction } from "./actions";
import { emptyActivityFormState } from "./form-state";
import type { ActivityTextLimits } from "@/shared/schemas/activity";




export interface ActivityFormValues {
  id?: string;
  activityDate: string;
  title: string;
  description: string;
  targetDepartmentIds: string[];
  /** The draft identity, if the activity came from a draft. */
  draftId?: string;

  attachments?: AttachmentPickerItem[];
  openFollowUp?: boolean;
}


function DraftBanner({
  savedAt,
  onRestore,
  onDiscard,
  locale,
  t,
}: {
  savedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
  locale: Parameters<typeof savedAtLabel>[2];
  t: ReturnType<typeof useTranslations>;
}) {
  const relativeTime = savedAtLabel(savedAt, new Date(), locale, {
    justNow: t("activities.justNow"),
    minutesAgo: (count) => t("activities.minutesAgo", { count }),
    hoursAgo: (count) => t("activities.hoursAgo", { count }),
  });

  return (
    <div
      data-test="unfinished-draft"
      className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-sm) border border-waiting-line bg-waiting-soft px-3.5 py-3"
    >
      <p className="text-[length:var(--text-sm)] text-ink">
        <span className="font-medium">{t("activities.draftBanner")}</span>{" "}
        <span className="text-muted">
          {t("activities.draftWrittenOnDevice", { date: relativeTime })}
        </span>
      </p>

      <span className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="primary" onClick={onRestore}>
          {t("activities.restoreDraft")}
        </Button>
        <Button type="button" size="sm" onClick={onDiscard}>
          {t("activities.deleteDraft")}
        </Button>
      </span>
    </div>
  );
}

export function ActivityForm({
  options,
  values,
  mode,
  draftKey,
  draftCount = 0,
  limits,
  attachmentLimits,
}: {
  options: TargetOption[];
  values: ActivityFormValues;
  mode: "create" | "edit";

  attachmentLimits: { maxSizeBytes: number; maxCount: number };

  limits: ActivityTextLimits;

  draftCount?: number;

  draftKey: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, formAction, submitPending] = useActionState(
    mode === "create" ? createActivityAction : updateActivityAction,
    emptyActivityFormState,
  );



  //




  const router = useRouter();
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftPending, setDraftPending] = useState(false);




  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(
    values.targetDepartmentIds,
  );

  const { formRef, pending: localDraft, restore, discard, submitted } = useActivityDraft(
    draftKey,
    {
      activityDate: values.activityDate,
      title: values.title,
      description: values.description,
      targetDepartmentIds: values.targetDepartmentIds,
    },
    setSelectedDepartments,
  );

  const serverDraft = useServerDraft(formRef, values.draftId ?? null, mode === "create");

  const draftSave = async () => {
    const form = formRef.current;
    if (!form || draftPending) return;

    setDraftPending(true);
    setDraftError(null);

    const data = new FormData(form);
    data.set("draftId", serverDraft.draftId ?? "");
    data.set("savedManually", "1");

    try {
      const result = await saveDraftAction(emptyDraftState, data);

      if (result.error) {
        setDraftError(result.error);
        return;
      }

      // The server draft is now authoritative; stop the local copy and autosave.

      serverDraft.submitting();
      discard();
      router.push("/drafts?record=draft");
    } catch {
      setDraftError(t("activities.draftSaveError"));
    } finally {
      setDraftPending(false);
    }
  };

  return (
    <form
      ref={formRef}
      action={formAction}




      onSubmit={() => {
        submitted();
        serverDraft.submitting();
      }}
      className="flex flex-col gap-5"
    >

      <input
        type="hidden"
        name="draftId"
        value={serverDraft.draftId ?? ""}
      />


      {mode === "create" && draftCount > 0 && !serverDraft.draftId ? (
        <p
          data-test="draft-reminder"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-sm) border border-line bg-inset px-3.5 py-2.5 text-[length:var(--text-sm)] text-muted"
        >
          <span>
            {t("activities.unsubmittedDrafts", { count: draftCount })}
          </span>
          <a href="/drafts" className="text-primary underline-offset-4 hover:underline">
            {t("activities.goToDrafts")}
          </a>
        </p>
      ) : null}
      {localDraft ? (
        <DraftBanner
          savedAt={localDraft.savedAt}
          onRestore={restore}
          onDiscard={discard}
          locale={locale}
          t={t}
        />
      ) : null}

      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <FormGrid columns={2}>
        <Field htmlFor="activityDate" label={t("activities.activityDate")} required>
          <Input
            id="activityDate"
            name="activityDate"
            type="date"
            required
            defaultValue={values.activityDate}
          />
        </Field>

        <Field
          htmlFor="title"
          label={t("activities.formTitle")}
          required
          hint={
            limits.titleMin > 1
              ? t("activities.titleHint", { count: limits.titleMin })
              : undefined
          }
        >
          <Input
            id="title"
            name="title"
            required
            minLength={limits.titleMin}
            maxLength={limits.titleMax}
            defaultValue={values.title}
            placeholder={t("activities.formTitlePlaceholder")}
          />
        </Field>
      </FormGrid>

      <Field
        htmlFor="description"
        label={t("activities.formDescription")}
        hint={t("activities.descriptionHint")}
        required
      >
        <Textarea
          id="description"
          name="description"
          required
          rows={8}
          minLength={limits.descriptionMin}
          maxLength={limits.descriptionMax}
          defaultValue={values.description}
        />
        {limits.descriptionMin > 1 ? (
          <p className="mt-1 text-[length:var(--text-2xs)] text-faint">
            {t("activities.descriptionMinimum", { count: limits.descriptionMin })}
          </p>
        ) : null}
      </Field>

      <fieldset className="flex flex-col gap-2.5 rounded-(--radius-sm) border border-line bg-inset/40 p-3.5">
        <legend className="px-1 text-[length:var(--text-sm)] font-medium text-ink">
          {t("activities.relatedDepartments")}
        </legend>
        <p className="text-[length:var(--text-xs)] text-muted">
          {t("activities.relatedDepartmentsHint", {
            count: MAX_TARGET_DEPARTMENTS,
          })}
        </p>

        <DepartmentPicker
          options={options}
          selected={selectedDepartments}
          onChange={setSelectedDepartments}
          max={MAX_TARGET_DEPARTMENTS}
        />
      </fieldset>

      {mode === "create" ? (
        <Checkbox
          name="openFollowUp"
          label={t("activities.keepTopicOpen")}
          description={t("activities.keepTopicOpenDescription")}
        />
      ) : null}

      <Field htmlFor="files" label={t("activities.attachmentsOptional")}>
        <AttachmentPicker
          existingAttachments={values.attachments}
          maxCount={attachmentLimits.maxCount}
          maxSizeBytes={attachmentLimits.maxSizeBytes}
        />
      </Field>

      <FormActions
        message={
          state.error || draftError ? (
            <div id="activity-error">
              <Alert tone="danger">{state.error ?? draftError}</Alert>
            </div>
          ) : null
        }
      >
        <Button type="submit" variant="primary" disabled={submitPending}>
          {submitPending
            ? mode === "create"
              ? t("activities.submitting")
              : t("common.saving")
            : mode === "create"
              ? t("common.submit")
              : t("common.save")}
        </Button>

        {mode === "create" ? (
          <Button type="button" onClick={draftSave} disabled={draftPending}>
            {draftPending ? t("activities.draftSaving") : t("activities.saveAsDraft")}
          </Button>
        ) : null}

        <ButtonLink href={values.id ? `/activities/${values.id}` : "/activities"}>
          {t("common.cancel")}
        </ButtonLink>

        {mode === "create" ? (
          <span
            role="status"
            aria-live="polite"
            data-test="draft-status"
            className="text-[length:var(--text-xs)] text-faint"
          >
            {serverDraft.status === "saving"
              ? t("activities.draftSaving")
              : serverDraft.status === "saved"
                ? t("activities.draftSaved")
                : serverDraft.status === "error"
                  ? t("activities.draftSaveError")
                  : ""}
          </span>
        ) : null}
      </FormActions>
    </form>
  );
}
