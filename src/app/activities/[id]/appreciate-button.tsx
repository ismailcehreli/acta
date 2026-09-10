"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { appreciateAction } from "./appreciation-actions";
import { emptyAppreciationState } from "./appreciation-state";

// Takdir düğmesi (Görev 11.11).
//
// Takdir **kayda** verilir, puan katkısı ise onaylanmış faaliyetin sahibine
// yazılır. Katkı miktarı skor ayarındaki takdir başına puana bağlıdır.

export function AppreciateButton({
  activityId,
  count,
  already,
}: {
  activityId: string;
  count: number;
  /** Bu kişi zaten takdir etti mi. */
  already: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    appreciateAction,
    emptyAppreciationState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input type="hidden" name="activityId" value={activityId} />
        <Button type="submit" size="sm" disabled={pending || already}>
          {already ? `Takdir edildi (${count})` : `Takdir et${count > 0 ? ` (${count})` : ""}`}
        </Button>
        {state.error ? (
          <span className="text-[length:var(--text-xs)] text-danger">{state.error}</span>
        ) : null}
      </div>
      {/* Yan etki arayüzde açık olsun: bu düğme yalnız kayda not düşmüyor,
          faaliyeti yazana skor katkısı da yazıyor (DESIGN-IS-2026-09-02,
          Görev 15.5) — önceden yalnız kod yorumunda belgeliydi. */}
      {!already ? (
        <p className="text-[length:var(--text-xs)] text-faint">
          Takdiriniz, faaliyeti yazana skor katkısı olarak yansır.
        </p>
      ) : null}
    </form>
  );
}
