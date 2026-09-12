"use client";

import { useActionState, useState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";

import { emptyActivityFormState } from "../form-state";
import {
  approveActivityAction,
  rejectActivityAction,
  requestChangesAction,
} from "./approval-actions";



//


//




export interface ReasonOption {
  id: string;
  label: string;
}


function DecisionForm({
  activityId,
  name,
  reasons,
  action,
  isPending,
  pendingLabel,
  reasonLabel,
  hint,
  buttonLabel,
  selectLabel,
  noteLabel,
  noteHint,
  noReasonMessage,
}: {
  activityId: string;
  name: string;
  reasons: ReasonOption[];
  action: (formData: FormData) => void;
  isPending: boolean;
  reasonLabel: string;
  hint: string;
  buttonLabel: string;
  pendingLabel: string;
  selectLabel: string;
  noteLabel: string;
  noteHint: string;
  noReasonMessage: React.ReactNode;
}) {
  const selectId = `${name}-reason-${activityId}`;
  const noteId = `${name}-note-${activityId}`;

  if (reasons.length === 0) {
    return (
      <Alert tone="correction">
        {noReasonMessage}
      </Alert>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" data-test={`${name}-form`}>
      <input type="hidden" name="id" value={activityId} />

      <Field htmlFor={selectId} label={reasonLabel} hint={hint} required>
        <Select id={selectId} name="reasonId" required defaultValue="">
          <option value="" disabled>
            {selectLabel}
          </option>
          {reasons.map((reason) => (
            <option key={reason.id} value={reason.id}>
              {reason.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        htmlFor={noteId}
        label={noteLabel}
        hint={noteHint}
      >
        <Textarea id={noteId} name="note" rows={3} maxLength={1000} />
      </Field>

      <div>
        <Button type="submit" variant="danger" disabled={isPending}>
          {isPending ? pendingLabel : buttonLabel}
        </Button>
      </div>
    </form>
  );
}

export function ApprovalPanel({
  activityId,
  canApprove,
  changesReasons,
  rejectReasons,
}: {
  activityId: string;
  /** A record with requested changes has no approval action; rejection remains available. */
  canApprove: boolean;
  changesReasons: ReasonOption[];
  rejectReasons: ReasonOption[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState<"none" | "changes" | "reject">("none");

  const [approvalStatus, approvalAction, approvalPending] = useActionState(
    approveActivityAction,
    emptyActivityFormState,
  );
  const [changesStatus, changesAction, changesPending] = useActionState(
    requestChangesAction,
    emptyActivityFormState,
  );
  const [rejectStatus, rejectAction, rejectPending] = useActionState(
    rejectActivityAction,
    emptyActivityFormState,
  );

  return (
      <div className="flex flex-col gap-3" data-test="approval-panel">
      <div className="flex flex-wrap items-center gap-2">
        {canApprove ? (
          <form action={approvalAction}>
            <input type="hidden" name="id" value={activityId} />
            <Button type="submit" variant="primary" disabled={approvalPending}>
              {approvalPending ? t("approvals.approving") : t("approvals.approveSingle")}
            </Button>
          </form>
        ) : null}

        {canApprove ? (
          <Button
            type="button"
            onClick={() => setOpen((o) => (o === "changes" ? "none" : "changes"))}
            aria-expanded={open === "changes"}
          >
            {open === "changes"
              ? t("common.cancel")
              : t("approvals.requestChanges")}
          </Button>
        ) : null}

        <Button
          type="button"
          onClick={() => setOpen((o) => (o === "reject" ? "none" : "reject"))}
          aria-expanded={open === "reject"}
        >
          {open === "reject" ? t("common.cancel") : t("approvals.reject")}
        </Button>
      </div>

      {open === "changes" ? (
        <DecisionForm
          activityId={activityId}
          name="changes"
          reasons={changesReasons}
          action={changesAction}
          isPending={changesPending}
          reasonLabel={t("approvals.changesReason")}
          hint={t("approvals.changesHint")}
          buttonLabel={t("approvals.requestChanges")}
          pendingLabel={t("approvals.requestingChanges")}
          selectLabel={t("approvals.selectReason")}
          noteLabel={t("approvals.noteOptional")}
          noteHint={t("approvals.noteHint")}
          noReasonMessage={
            <>
              {t("approvals.noReasonDefined")} {" "}
              <span className="font-medium">{t("approvals.approvalReasonsLink")}</span>.
            </>
          }
        />
      ) : null}

      {open === "reject" ? (
        <DecisionForm
          activityId={activityId}
          name="reject"
          reasons={rejectReasons}
          action={rejectAction}
          isPending={rejectPending}
          reasonLabel={t("approvals.rejectReason")}
          hint={t("approvals.rejectHint")}
          buttonLabel={t("approvals.reject")}
          pendingLabel={t("approvals.rejecting")}
          selectLabel={t("approvals.selectReason")}
          noteLabel={t("approvals.noteOptional")}
          noteHint={t("approvals.noteHint")}
          noReasonMessage={
            <>
              {t("approvals.noReasonDefined")} {" "}
              <span className="font-medium">{t("approvals.approvalReasonsLink")}</span>.
            </>
          }
        />
      ) : null}

      {approvalStatus.error ? <Alert tone="danger">{approvalStatus.error}</Alert> : null}
      {changesStatus.error ? (
        <Alert tone="danger">{changesStatus.error}</Alert>
      ) : null}
      {rejectStatus.error ? <Alert tone="danger">{rejectStatus.error}</Alert> : null}
    </div>
  );
}
