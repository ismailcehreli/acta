import type { PrismaClient } from "@prisma/client";

import { listPendingApprovals } from "@/server/activities/approval";
import { listVisibleActivities } from "@/server/authz/activity-repository";
import { businessDaysBetween } from "@/server/calendar/business-days";
import { readWorkCalendar } from "@/server/calendar/settings";
import { loadWorkCalendar } from "@/server/calendar/work-calendar";
import {
  listOpenWorkItems,
  type ConversationReadDb,
} from "@/server/conversations/read";
import type { Viewer } from "@/server/authz/visibility";


//




//





export type WorkQueueDb = ConversationReadDb &
  Pick<PrismaClient, "workCalendar" | "holiday">;

export type WorkKind = "answer" | "approve" | "revise";

export interface WorkItem {
  kind: WorkKind;
  activityId: string;
  activityTitle: string;

  fromName: string;

  since: Date;

  waitingBusinessDays: number;
}


export interface WatchedItem {
  activityId: string;
  activityTitle: string;
  counterpartName: string;
  since: Date;
  waitingBusinessDays: number;
}

export interface WorkQueue {
  items: WorkItem[];
  watched: WatchedItem[];
}

const WORK_KIND_LABELS: Record<WorkKind, string> = {
  answer: "Answer",
  approve: "Approve",
  revise: "Revise",
};

export function workKindLabel(kind: WorkKind): string {
  return WORK_KIND_LABELS[kind];
}

export async function listWorkQueue(
  db: WorkQueueDb,
  viewer: Viewer,
  now: Date,
): Promise<WorkQueue> {
  const [calendarSettings, conversations, approvals, revisions] = await Promise.all([
    readWorkCalendar(db),
    listOpenWorkItems(db, viewer),



    listPendingApprovals(db, viewer.id, now),



    listVisibleActivities(db, viewer, {
      where: { authorId: viewer.id, approvalStatus: "CHANGES_REQUESTED" },
      orderBy: { approvalDecidedAt: "asc" },
      select: {
        id: true,
        title: true,
        approvalDecidedAt: true,
        approver: { select: { fullName: true } },
      },
    }),
  ]);


  const earliest = [
    ...conversations.map((conversation) => conversation.openedAt),
    ...approvals.map((approval) => approval.activityDate),
    ...revisions.map((revision) => revision.approvalDecidedAt ?? now),
  ].reduce((min, date) => (date < min ? date : min), now);

  const calendar = await loadWorkCalendar(db, earliest, now);

  const dayOptions = {
    workingDays: calendarSettings.workingDays,
    holidays: calendar.holidays,
  };

  const waitingBusinessDays = (since: Date) =>
    businessDaysBetween(since, now, dayOptions);

  const items: WorkItem[] = [
    ...conversations
      .filter((conversation) => conversation.waitingOnMe)
      .map((conversation) => ({
        kind: "answer" as const,
        activityId: conversation.activityId,
        activityTitle: conversation.activityTitle,
        fromName: conversation.counterpartName,
        since: conversation.openedAt,
        waitingBusinessDays: waitingBusinessDays(conversation.openedAt),
      })),

    ...approvals.map((approval) => ({
      kind: "approve" as const,
      activityId: approval.id,
      activityTitle: approval.title,
      fromName: approval.authorName,
      since: approval.activityDate,
      waitingBusinessDays: waitingBusinessDays(approval.activityDate),
    })),

    ...revisions.map((record) => ({
      kind: "revise" as const,
      activityId: record.id,
      activityTitle: record.title,
      fromName: record.approver?.fullName ?? "Your manager",


      since: record.approvalDecidedAt ?? now,
      waitingBusinessDays: record.approvalDecidedAt
        ? waitingBusinessDays(record.approvalDecidedAt)
        : 0,
    })),
  ];



  items.sort((a, b) => a.since.getTime() - b.since.getTime());

  const watched: WatchedItem[] = conversations
    .filter((conversation) => !conversation.waitingOnMe)
    .map((conversation) => ({
      activityId: conversation.activityId,
      activityTitle: conversation.activityTitle,
      counterpartName: conversation.counterpartName,
      since: conversation.openedAt,
      waitingBusinessDays: waitingBusinessDays(conversation.openedAt),
    }))
    .sort((a, b) => a.since.getTime() - b.since.getTime());

  return { items, watched };
}
