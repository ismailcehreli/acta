"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useTranslations } from "@/components/i18n/provider";

import {
  deactivateOrgUnitAction,
  moveOrgUnitAction,
  reactivateOrgUnitAction,
} from "./actions";
import { emptyOrgFormState } from "./form-state";
import type { UnitOption } from "./org-form";
export function OrgUnitActions({
  unitId,
  unitName,
  options,
}: {
  unitId: string;
  unitName: string;
  options: UnitOption[];
}) {
  const t = useTranslations();
  const [moveState, moveAction, movePending] = useActionState(
    moveOrgUnitAction,
    emptyOrgFormState,
  );
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateOrgUnitAction,
    emptyOrgFormState,
  );

  const message = moveState.error ?? deactivateState.error;
  const calendarChange = moveState.calendarConfirm;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {options.length > 0 ? (
        <form action={moveAction} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={unitId} />
          <label className="sr-only" htmlFor={`move-${unitId}`}>
            {t("screens.organization.moveLabel", { unit: unitName })}
          </label>
          <Select
            id={`move-${unitId}`}
            name="newParentId"
            defaultValue=""
            className="w-auto py-1 text-[length:var(--text-xs)]"
          >
            <option value="" disabled>
              {t("screens.organization.movePlaceholder")}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={movePending}>
            {t("screens.organization.move")}
          </Button>
        </form>
      ) : null}

      <form action={deactivateAction}>
        <input type="hidden" name="id" value={unitId} />
        <Button type="submit" size="sm" variant="danger" disabled={deactivatePending}>
          {t("screens.organization.deactivate")}
        </Button>
      </form>

      {message ? <Alert tone="danger">{message}</Alert> : null}

      {/* Show the calendar impact before a move is confirmed. */}
      {calendarChange && calendarChange.unitId === unitId ? (
        <Alert tone="correction">
          <span className="flex flex-col gap-2" data-test="move-calendar-warning">
            <strong>{t("screens.organization.moveCalendarWarning")}</strong>
            <span className="flex flex-col gap-1 text-[length:var(--text-xs)]">
              <span>
                {t("screens.organization.currentCalendar")}: {calendarChange.before.days} · {calendarChange.before.hours} ·{" "}
                {calendarChange.before.holidays} ({calendarChange.before.source})
              </span>
              <span>
                {t("screens.organization.nextCalendar")}: {calendarChange.after.days} · {calendarChange.after.hours} ·{" "}
                {calendarChange.after.holidays} ({calendarChange.after.source})
              </span>
              <span className="text-muted">
                {t("screens.organization.moveCalendarDescription")}
              </span>
            </span>
            <form action={moveAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={calendarChange.unitId} />
              <input type="hidden" name="newParentId" value={calendarChange.newParentId} />
              <input
                type="hidden"
                name="confirmedCalendarSignature"
                value={calendarChange.signature}
              />
              <Button type="submit" size="sm" disabled={movePending}>
                {t("screens.organization.confirmMove")}
              </Button>
            </form>
          </span>
        </Alert>
      ) : null}
    </span>
  );
}

/**
 * Reactivate an inactive unit. The action appears only on inactive rows so
 * its meaning is unambiguous.
 */
export function OrgUnitReactivate({ unitId }: { unitId: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    reactivateOrgUnitAction,
    emptyOrgFormState,
  );

  return (
    <span className="flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={unitId} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending
            ? t("screens.organization.opening")
            : t("screens.organization.reactivate")}
        </Button>
      </form>

      {state.error ? (
        <Alert tone="danger">
          {state.error}
        </Alert>
      ) : null}
    </span>
  );
}
