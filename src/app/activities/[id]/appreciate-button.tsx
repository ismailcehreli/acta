"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Button } from "@/components/ui/button";

import { appreciateAction } from "./appreciation-actions";
import { emptyAppreciationState } from "./appreciation-state";


//



export function AppreciateButton({
  activityId,
  count,
  already,
}: {
  activityId: string;
  count: number;
  already: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    appreciateAction,
    emptyAppreciationState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input type="hidden" name="activityId" value={activityId} />
        <Button type="submit" size="sm" disabled={pending || already}>
          {already
            ? `${t("activities.appreciated")} (${count})`
            : `${t("activities.appreciate")}${count > 0 ? ` (${count})` : ""}`}
        </Button>
        {state.error ? (
          <span className="text-[length:var(--text-xs)] text-danger">{state.error}</span>
        ) : null}
      </div>
      {!already ? (
        <p className="text-[length:var(--text-xs)] text-faint">
          {t("activities.appreciationHint")}
        </p>
      ) : null}
    </form>
  );
}
