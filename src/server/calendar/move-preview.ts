import type { UnitCalendarDb, UnitWorkWindow } from "./unit-calendar";

import { resolveUnitWorkWindow } from "./unit-calendar";

// Unit move effect on work window (audit 2026-08-23, finding 14).
//
// Move affects more than just tree visualization: shift window is inherited from parent;
// moving to another branch shifts everyone's reminder time and score denominator.

export interface UnitMoveCalendarPreview {
  /** Current window. */
  current: UnitWorkWindow;
  /** Window that will apply after move. */
  next: UnitWorkWindow;
  /** Whether the two windows differ; if false, confirmation is not requested. */
  changes: boolean;
  /** Fingerprint of the preview. */
  signature: string;

}

/** Reduces work window to a single comparable string. */
export function workWindowSignature(window: UnitWorkWindow): string {
  return [
    [...window.workingDays].sort((a, b) => a - b).join("-"),
    window.workStartMinute,
    window.workEndMinute,
    window.worksOnHolidays ? "holiday" : "no-holiday",
  ].join("|");
}

/**
 * Windows that apply before and after the move.
 *
 * A unit with its own calendar is unaffected: if not inherited, moving does not change it.
 */
export async function previewUnitMoveCalendar(
  db: UnitCalendarDb,
  unitId: string,
  newParentId: string,
): Promise<UnitMoveCalendarPreview> {
  const current = await resolveUnitWorkWindow(db, unitId);

  if (current.source === "unit") {
    const sig = `${workWindowSignature(current)}=>${workWindowSignature(current)}`;
    return {
      current,
      next: current,
      changes: false,
      signature: sig,
    };
  }

  // Inherited window comes from new parent's chain.
  const parentWindow = await resolveUnitWorkWindow(db, newParentId);
  const next: UnitWorkWindow =
    parentWindow.source === "company"
      ? { ...parentWindow }
      : {
          ...parentWindow,
          source: "inherited",
          sourceUnitName:
            parentWindow.source === "unit"
              ? await getUnitName(db, newParentId)
              : parentWindow.sourceUnitName,
        };

  const currentSig = workWindowSignature(current);
  const nextSig = workWindowSignature(next);
  const changes = currentSig !== nextSig;
  const sig = `${currentSig}=>${nextSig}`;

  return {
    current,
    next,
    changes,
    signature: sig,
  };
}

async function getUnitName(db: UnitCalendarDb, id: string): Promise<string | null> {
  const unit = await db.orgUnit.findUnique({ where: { id }, select: { name: true } });
  return unit?.name ?? null;
}
