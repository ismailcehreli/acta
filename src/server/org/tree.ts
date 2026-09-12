import type { OrgUnit, PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import {
  previewUnitMoveCalendar,
  type UnitMoveCalendarPreview,
} from "@/server/calendar/move-preview";
import { WORK_WINDOW_LOCK_KEY } from "@/server/calendar/unit-calendar";
import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";

import type {
  CreateOrgUnitInput,
  MoveOrgUnitInput,
  UpdateOrgUnitInput,
} from "@/shared/schemas/org";

import { ORG_TREE_LOCK_KEY } from "./locks";

// Organization tree operations (§4). Integrity rules of the tree are enforced
// in the database (single root, no cycles, max depth 10, no active users in inactive units);
// this layer translates database rejections into user-friendly error responses.

export type OrgTreeDb = Pick<
  PrismaClient,
  "orgUnit" | "user" | "auditLog" | "$transaction"
>;

export type OrgTreeErrorCode =
  | "not_found"
  | "inactive_unit"
  | "already_active"
  | "cycle"
  | "max_depth"
  | "duplicate_root"
  | "parent_not_found"
  | "has_active_users"
  | "has_active_children"
  | "inactive_parent"
  | "calendar_change_unconfirmed"
  | "calendar_preview_stale"
  | "unknown";

export interface OrgTreeFailure {
  ok: false;
  error: OrgTreeErrorCode;
  message: string;
  /**
   * If move changes the shift window, returns both windows for UI warning.
   */
  calendarChange?: UnitMoveCalendarPreview;
}

export type OrgTreeResult<T> = { ok: true; value: T } | OrgTreeFailure;

/** Rolls back the move and surfaces the preview to the caller. */
class CalendarConfirmationNeeded extends Error {
  constructor(
    readonly code: "calendar_change_unconfirmed" | "calendar_preview_stale",
    readonly preview: UnitMoveCalendarPreview,
  ) {
    super(code);
  }
}

const MESSAGES: Record<OrgTreeErrorCode, string> = {
  not_found: "Unit not found.",
  inactive_unit: "Inactive unit cannot be edited. It must be activated first.",
  already_active: "Unit is already active.",
  cycle: "A unit cannot be moved under one of its own descendants.",
  max_depth: "Organization tree can have at most 10 levels.",
  duplicate_root: "The tree can only have one root unit.",
  parent_not_found: "Parent unit not found.",
  has_active_users:
    "This unit has active users. Move or deactivate users first.",
  has_active_children:
    "This unit has active child units. Move or deactivate child units first.",
  inactive_parent:
    "Parent unit is inactive. Activate parent unit first; an active unit cannot be under an inactive unit.",
  calendar_change_unconfirmed:
    "This move changes the unit's shift window. Confirm the change.",
  calendar_preview_stale:
    "The shift window changed before you confirmed. Review new values and reconfirm.",
  unknown: "Operation could not be completed.",
};

function fail(error: OrgTreeErrorCode): OrgTreeFailure {
  return { ok: false, error, message: MESSAGES[error] };
}

/** Translates rejected database error into recognizable error code. */
function translateDatabaseError(error: unknown): OrgTreeFailure {
  // Constraint names checked via SENTINEL prefix.
  if (hasDatabaseSentinel(error, "ORG_TREE_CYCLE")) return fail("cycle");
  if (hasDatabaseSentinel(error, "ORG_TREE_MAX_DEPTH")) return fail("max_depth");
  if (hasDatabaseSentinel(error, "ORG_UNIT_HAS_ACTIVE_USERS")) {
    return fail("has_active_users");
  }
  if (hasDatabaseSentinel(error, "ORG_UNIT_HAS_ACTIVE_CHILDREN")) {
    return fail("has_active_children");
  }
  if (hasDatabaseSentinel(error, "ORG_UNIT_INACTIVE_PARENT")) {
    return fail("inactive_parent");
  }
  if (hasDatabaseSentinel(error, "USER_INACTIVE_ORG_UNIT")) {
    return fail("inactive_parent");
  }

  // Partial unique index violation from Prisma may come without field name;
  // the only uniqueness constraint on this table is the root unit.
  if (isUniqueViolation(error)) return fail("duplicate_root");

  return fail("unknown");
}

export async function createOrgUnit(
  db: OrgTreeDb,
  input: CreateOrgUnitInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  if (input.parentId) {
    const parent = await db.orgUnit.findUnique({
      where: { id: input.parentId },
      select: { isActive: true },
    });

    if (!parent) return fail("parent_not_found");
    if (!parent.isActive) return fail("inactive_parent");
  }

  try {
    const unit = await db.$transaction(async (tx) => {
      const created = await tx.orgUnit.create({ data: input });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: created.id,
        action: AUDIT_ACTIONS.orgUnitCreated,
        detail: { name: created.name, type: created.type, parentId: created.parentId },
        now,
      });

      return created;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}


export async function updateOrgUnit(
  db: OrgTreeDb,
  input: UpdateOrgUnitInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const currentUnit = await db.orgUnit.findUnique({
    where: { id: input.id },
    select: {
      name: true,
      type: true,
      isActive: true,
      requiresApproval: true,
      autoFlowsUp: true,
      attentionGroupId: true,
    },
  });

  if (!currentUnit) return fail("not_found");



  if (!currentUnit.isActive) return fail("inactive_unit");

  const next = {
    name: input.name,
    type: input.type,
    requiresApproval: input.requiresApproval,
    autoFlowsUp: input.autoFlowsUp,
    attentionGroupId: input.attentionGroupId,
  };

  // Only changed fields are written to audit log.
  type Value = string | boolean | null;
  const changed: Record<string, { before: Value; after: Value }> = {};

  for (const [field, value] of Object.entries(next)) {
    const prevValue: Value = currentUnit[field as keyof typeof next];
    if (prevValue !== value) {
      changed[field] = { before: prevValue, after: value };
    }
  }

  try {
    const unit = await db.$transaction(async (tx) => {
      const current = await tx.orgUnit.update({
        where: { id: input.id },
        data: next,
      });

      // No record in audit log if nothing changed.
      if (Object.keys(changed).length > 0) {
        await recordAudit(tx, {
          userId: actorId,
          objectType: AUDIT_OBJECTS.orgUnit,
          objectId: current.id,
          action: AUDIT_ACTIONS.orgUnitUpdated,
          detail: { changed },
          now,
        });
      }

      return current;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function moveOrgUnit(
  db: OrgTreeDb,
  input: MoveOrgUnitInput,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const parent = await db.orgUnit.findUnique({
    where: { id: input.newParentId },
    select: { isActive: true },
  });

  if (!parent) return fail("parent_not_found");
  if (!parent.isActive) return fail("inactive_parent");

  try {
    const unit = await db.$transaction(async (tx) => {



      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ORG_TREE_LOCK_KEY}))`;


      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${WORK_WINDOW_LOCK_KEY}))`;

      const calendarChange = await previewUnitMoveCalendar(
        tx as unknown as OrgTreeDb & Parameters<typeof previewUnitMoveCalendar>[0],
        input.id,
        input.newParentId,
      );

      if (calendarChange.changes) {
        // A change to the shift window cannot be confirmed without showing its
        // side effect: the move shifts reminder times and score denominators.
        if (!input.confirmedCalendarSignature) {
          throw new CalendarConfirmationNeeded(
            "calendar_change_unconfirmed",
            calendarChange,
          );
        }

        // Check that the confirmed preview is still current. An intervening
        // calendar change would make the user's "X to Y" confirmation wrong.
        if (input.confirmedCalendarSignature !== calendarChange.signature) {
          throw new CalendarConfirmationNeeded(
            "calendar_preview_stale",
            calendarChange,
          );
        }
      }

      const previousParent = await tx.orgUnit.findUnique({
        where: { id: input.id },
        select: { parentId: true },
      });

      const current = await tx.orgUnit.update({
        where: { id: input.id },
        data: { parentId: input.newParentId },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: current.id,
        action: AUDIT_ACTIONS.orgUnitMoved,
        detail: {
          fromParentId: previousParent?.parentId ?? null,
          toParentId: input.newParentId,
        },
        now,
      });

      return current;
    });

    return { ok: true, value: unit };
  } catch (error) {
    if (error instanceof CalendarConfirmationNeeded) {
      return { ...fail(error.code), calendarChange: error.preview };
    }

    return translateDatabaseError(error);
  }
}

/**
 * A unit is deactivated, not deleted (§4.6). The database enforces both active
 * user and active child-unit guards; this pre-check exists only for a readable
 * response, while the database still rejects a concurrent violation (audit phase
 * 2, finding 4).
 */
export async function deactivateOrgUnit(
  db: OrgTreeDb,
  id: string,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const activeChildren = await db.orgUnit.count({
    where: { parentId: id, isActive: true },
  });

  if (activeChildren > 0) return fail("has_active_children");

  try {
    const unit = await db.$transaction(async (tx) => {
      const current = await tx.orgUnit.update({
        where: { id },
        data: { isActive: false },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: id,
        action: AUDIT_ACTIONS.orgUnitDeactivated,
        detail: { name: current.name },
        now,
      });

      return current;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export interface OrgUnitNode extends OrgUnit {
  children: OrgUnitNode[];
  /** Number of active users directly assigned to this unit. */
  activeUserCount: number;
}

/** Return the complete tree starting at the root for display. */
/**
 * Reactivate a deactivated unit (product-owner decision, 19.08.2026).
 *
 * **Child units are not reactivated automatically.** Restoring a whole branch
 * would silently revive child units that were deliberately deactivated. Activation
 * proceeds from the top down, one unit at a time.
 *
 * A unit with an inactive parent cannot be reactivated; the database trigger
 * (`OrgUnit_active_parent_guard`) enforces this, while this layer returns a
 * readable response.
 */
export async function reactivateOrgUnit(
  db: OrgTreeDb,
  id: string,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<OrgTreeResult<OrgUnit>> {
  const currentUnit = await db.orgUnit.findUnique({
    where: { id },
    select: { isActive: true },
  });

  if (!currentUnit) return fail("not_found");
  // Re-activating an already active unit is not silently treated as success;
  // it can indicate a problem in the UI or caller.
  if (currentUnit.isActive) return fail("already_active");

  try {
    const unit = await db.$transaction(async (tx) => {
      const current = await tx.orgUnit.update({
        where: { id },
        data: { isActive: true },
      });

      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.orgUnit,
        objectId: id,
        action: AUDIT_ACTIONS.orgUnitReactivated,
        detail: { name: current.name },
        now,
      });

      return current;
    });

    return { ok: true, value: unit };
  } catch (error) {
    return translateDatabaseError(error);
  }
}

export async function loadOrgTree(db: OrgTreeDb): Promise<OrgUnitNode[]> {
  const [units, userCounts] = await Promise.all([
    db.orgUnit.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.user.groupBy({
      by: ["orgUnitId"],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);

  const countByUnit = new Map(
    userCounts.map((row) => [row.orgUnitId, row._count._all]),
  );

  const nodes = new Map<string, OrgUnitNode>(
    units.map((unit) => [
      unit.id,
      { ...unit, children: [], activeUserCount: countByUnit.get(unit.id) ?? 0 },
    ]),
  );

  const roots: OrgUnitNode[] = [];

  for (const node of nodes.values()) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }

    nodes.get(node.parentId)?.children.push(node);
  }

  return roots;
}
