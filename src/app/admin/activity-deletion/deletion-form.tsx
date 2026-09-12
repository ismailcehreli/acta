"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";
import { useTranslations } from "@/components/i18n/provider";

import {
  searchActivityAction,
  sendCodeAction,
  deleteAction,
  type DeletionFormState,
} from "./actions";
const initialState: DeletionFormState = {};

export function ActivitySearch() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(
    searchActivityAction,
    initialState,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        htmlFor="activityId"
        label={t("screens.activityDeletion.activityIdLabel")}
        hint={t("screens.activityDeletion.activityIdHint")}
      >
        <Input
          id="activityId"
          name="activityId"
          placeholder={t("screens.activityDeletion.activityIdPlaceholder")}
          required
        />
      </Field>

      <FormActions
        message={state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      >
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("screens.activityDeletion.searching")
            : t("screens.activityDeletion.search")}
        </Button>
      </FormActions>
    </form>
  );
}

export function DeletionSteps({
  activityId,
  deletionOpen,
}: {
  activityId: string;
  deletionOpen: boolean;
}) {
  const t = useTranslations();
  const [codeState, codeAction, codePending] = useActionState(
    sendCodeAction,
    initialState,
  );
  const [deletionState, deletionAction, deletePending] = useActionState(
    deleteAction,
    initialState,
  );

  if (!deletionOpen) return null;

  if (deletionState.success) {
    return (
      <Alert tone="success">{deletionState.success}</Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={codeAction}>
        <input type="hidden" name="activityId" value={activityId} />
        <FormActions
          message={
            codeState.error ? (
              <Alert tone="danger">{codeState.error}</Alert>
            ) : codeState.success ? (
              <Alert tone="success">{codeState.success}</Alert>
            ) : null
          }
        >
          <Button type="submit" variant="secondary" disabled={codePending}>
            {codePending
              ? t("screens.activityDeletion.sendingCode")
              : t("screens.activityDeletion.sendCode")}
          </Button>
        </FormActions>
      </form>

      <form action={deletionAction} className="flex flex-col gap-3">
        <input type="hidden" name="activityId" value={activityId} />
        <Field
          htmlFor="code"
          label={t("screens.activityDeletion.codeLabel")}
          hint={t("screens.activityDeletion.codeHint")}
        >
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            required
          />
        </Field>

        <FormActions
          message={deletionState.error ? <Alert tone="danger">{deletionState.error}</Alert> : null}
        >
          <Button type="submit" variant="danger" disabled={deletePending}>
            {deletePending
              ? t("screens.activityDeletion.deleting")
              : t("screens.activityDeletion.deleteRecord")}
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
