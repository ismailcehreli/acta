"use client";

import { useActionState, useState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Button } from "@/components/ui/button";

import { deleteDraftAction } from "./actions";
import { emptyDraftState } from "./form-state";

// Draft deletion.
//


// A draft is removed only after the user confirms the action.
//




export function DeleteDraftButton({ id, title }: { id: string; title: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    deleteDraftAction,
    emptyDraftState,
  );
  const [approvalPending, setApprovalPending] = useState(false);

  if (!approvalPending) {
    return (
      <>
        <Button
          type="button"
          size="sm"
          onClick={() => setApprovalPending(true)}
          aria-label={`${title}: ${t("screens.drafts.delete")}`}
        >
          {t("screens.drafts.delete")}
        </Button>
        {state.error ? (
          <span className="text-[length:var(--text-xs)] text-danger">
            {state.error}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-[length:var(--text-xs)] text-muted">
        {t("screens.drafts.deleteConfirm")}
      </span>
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? t("screens.drafts.deleting") : t("screens.drafts.delete")}
      </Button>
      <Button type="button" size="sm" onClick={() => setApprovalPending(false)}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
