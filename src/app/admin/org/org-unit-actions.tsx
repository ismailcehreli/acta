"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";

import {
  deactivateOrgUnitAction,
  moveOrgUnitAction,
  reactivateOrgUnitAction,
} from "./actions";
import { emptyOrgFormState } from "./form-state";
import type { UnitOption } from "./org-form";

// Birim başına üç işlem: taşıma, pasifleştirme ve aktifleştirme. Silme yoktur
// (§16.6) — pasifleştirilen birim kayıtta kalır ve geri açılabilir.

export function OrgUnitActions({
  unitId,
  unitName,
  options,
}: {
  unitId: string;
  unitName: string;
  options: UnitOption[];
}) {
  const [moveState, moveAction, movePending] = useActionState(
    moveOrgUnitAction,
    emptyOrgFormState,
  );
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateOrgUnitAction,
    emptyOrgFormState,
  );

  const message = moveState.error ?? deactivateState.error;
  const onay = moveState.calendarConfirm;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {options.length > 0 ? (
        <form action={moveAction} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={unitId} />
          <label className="sr-only" htmlFor={`tasi-${unitId}`}>
            {unitName} biriminin yeni üstü
          </label>
          <Select
            id={`tasi-${unitId}`}
            name="newParentId"
            defaultValue=""
            className="w-auto py-1 text-[length:var(--text-xs)]"
          >
            <option value="" disabled>
              Taşı…
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={movePending}>
            Taşı
          </Button>
        </form>
      ) : null}

      <form action={deactivateAction}>
        <input type="hidden" name="id" value={unitId} />
        <Button type="submit" size="sm" variant="danger" disabled={deactivatePending}>
          Pasifleştir
        </Button>
      </form>

      {message && !onay ? <Alert tone="danger">{message}</Alert> : null}

      {/* **Taşımanın görünmeyen yan etkisi burada görünür oluyor** (tasarım
          Paket H). Birim başka bir dala geçince mesai penceresini oradan
          devralıyor; o birimdeki herkesin hatırlatma saati ve skor paydası
          kayıyor. Onay adımı iki değeri yan yana gösteriyor. */}
      {onay && onay.unitId === unitId ? (
        <Alert tone="correction">
          <span className="flex flex-col gap-2" data-test="tasima-takvim-uyarisi">
            <strong>Bu taşıma mesai penceresini değiştirecek.</strong>
            <span className="flex flex-col gap-1 text-[length:var(--text-xs)]">
              <span>
                Şu an: {onay.before.days} · {onay.before.hours} ·{" "}
                {onay.before.holidays} ({onay.before.source})
              </span>
              <span>
                Taşındıktan sonra: {onay.after.days} · {onay.after.hours} ·{" "}
                {onay.after.holidays} ({onay.after.source})
              </span>
              <span className="text-muted">
                Bu birimdeki kişilerin hatırlatma saati ve skor paydası da
                değişir.
              </span>
            </span>
            <form action={moveAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={onay.unitId} />
              <input type="hidden" name="newParentId" value={onay.newParentId} />
              <input
                type="hidden"
                name="confirmedCalendarSignature"
                value={onay.signature}
              />
              <Button type="submit" size="sm" disabled={movePending}>
                Taşımayı onayla
              </Button>
            </form>
          </span>
        </Alert>
      ) : null}
    </span>
  );
}

/**
 * Pasif birimi geri açar. Yalnız pasif satırlarda görünür; aktif birimin
 * yanında "aktifleştir" düğmesi olması, düğmenin ne yaptığını belirsizleştirir.
 */
export function OrgUnitReactivate({ unitId }: { unitId: string }) {
  const [state, formAction, pending] = useActionState(
    reactivateOrgUnitAction,
    emptyOrgFormState,
  );

  return (
    <span className="flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={unitId} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Açılıyor…" : "Aktifleştir"}
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
