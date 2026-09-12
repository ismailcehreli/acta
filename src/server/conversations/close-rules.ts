import { businessDaysBetween } from "@/server/calendar/business-days";

// Closing rules (§9.3). Table:
//
//   Asker                     -> always
//   Responsible for question  -> no; replies, cannot close
//   Asker's supervisor        -> if asker has been inactive for 10 business days
//   System administrator      -> justified administrative closure
//
// Conversations closed by activity cancellation do not pass through this decision;
// they receive a separate close type (CANCELLED_ACTIVITY) and the reason stays in cancellation record.
//
// Rules are kept in a pure function so they can be tested with mock clock and without database.

/**
 * Number of business days before asker's supervisor can intervene.
 * Default; live value comes from system settings (§16.5) and is carried in context.
 */
export const SUPERVISOR_TAKEOVER_BUSINESS_DAYS = 10;

export type CloseDecision =
  | {
      allowed: true;
      closeType: "NORMAL" | "ADMINISTRATIVE";
      /** Reason is mandatory for administrative closure (§9.3). */
      requiresReason: boolean;
    }
  | { allowed: false; reason: CloseRefusal };

export type CloseRefusal =
  /** Responsible replies, cannot close (§9.3). */
  | "responsible_cannot_close"
  /** Asker's supervisor cannot intervene yet. */
  | "supervisor_too_early"
  /** Person unrelated to the conversation. */
  | "not_a_party"
  /** Administrative closure requires a reason. */
  | "reason_required"
  | "already_closed";

export interface CloseContext {
  status: "OPEN" | "CLOSED";
  askerId: string;
  /** Target of conversation: author of activity. Does not change with replies. */
  respondentId: string;
  openedAt: Date;
  /** Asker's last action; otherwise opening timestamp. */
  lastAskerActionAt: Date;
  now: Date;
  /** Person making the decision. */
  actorId: string;
  actorIsSystemAdmin: boolean;
  /** Whether actor is in asker's management chain (§4.4). */
  actorIsAskerSupervisor: boolean;
  /** Whether either party was deactivated. */
  anyPartyInactive: boolean;
  /** Company working days; defaults to weekdays if omitted. */
  workingDays?: number[];
  /** Business days required for supervisor takeover; defaults to default constant if omitted. */
  supervisorTakeoverDays?: number;
  holidays?: string[];
}

export function decideClose(context: CloseContext): CloseDecision {
  if (context.status === "CLOSED") {
    return { allowed: false, reason: "already_closed" };
  }

  // Asker can always close.
  if (context.actorId === context.askerId) {
    return { allowed: true, closeType: "NORMAL", requiresReason: false };
  }

  // Responsible party can never close: replying is not closing.
  if (context.actorId === context.respondentId) {
    return { allowed: false, reason: "responsible_cannot_close" };
  }

  if (context.actorIsAskerSupervisor) {
    const idleBusinessDays = businessDaysBetween(
      context.lastAskerActionAt,
      context.now,
      { workingDays: context.workingDays, holidays: context.holidays },
    );

    const threshold =
      context.supervisorTakeoverDays ?? SUPERVISOR_TAKEOVER_BUSINESS_DAYS;

    if (idleBusinessDays >= threshold) {
      return { allowed: true, closeType: "NORMAL", requiresReason: false };
    }

    return { allowed: false, reason: "supervisor_too_early" };
  }

  // System administrator's administrative closure (§9.3) enables deactivation:
  // §4.6 prevents deactivation if user has open conversations.
  // Administrative closure requires a reason.
  if (context.actorIsSystemAdmin) {
    return { allowed: true, closeType: "ADMINISTRATIVE", requiresReason: true };
  }

  return { allowed: false, reason: "not_a_party" };
}
