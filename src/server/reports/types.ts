import type { ReportScope } from "@/server/authz/visibility";

import type { ReportPeriodRange } from "./range";

export type ReportTab =
  | "activities"
  | "absence"
  | "notifications"
  | "scores"
  | "feedback";

export interface ActivityReport {
  tab: "activities";
  total: number;
  people: number;
  activityDays: number;
  approved: number;
  pending: number;
  changesRequested: number;
  rejected: number;
  cancelled: number;
  approvalRate: number | null;
  pendingOlderThanSevenDays: number;
  units: {
    id: string;
    name: string;
    depth: number;
    people: number;
    directPeople: number;
    activities: number;
    directActivities: number;
    approved: number;
    pending: number;
    approvalRate: number | null;
  }[];
}

export interface AbsenceReport {
  tab: "absence";
  periods: number;
  people: number;
  approved: number;
  pending: number;
  rejected: number;
  cancelled: number;
  approvedDays: number;
  pendingDays: number;
  units: {
    id: string;
    name: string;
    depth: number;
    people: number;
    periods: number;
    approvedDays: number;
    pending: number;
    approved: number;
  }[];
}

export interface NotificationsReport {
  tab: "notifications";
  total: number;
  pending: number;
  sent: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  byChannel: { label: string; count: number }[];
  byEvent: { label: string; count: number }[];
  units: {
    id: string;
    name: string;
    depth: number;
    total: number;
    pending: number;
    sent: number;
    failed: number;
    cancelled: number;
  }[];
}

export interface ScoreSummary {
  periods: number;
  people: number;
  averageTotal: number | null;
  averageRegularity: number | null;
  averageAcceptance: number | null;
  averageApproval: number | null;
  averageFollowUp: number | null;
  appreciationCount: number;
  appreciationPoints: number;
}

export interface ScoresReport extends ScoreSummary {
  tab: "scores";
  units: (ScoreSummary & { id: string; name: string; depth: number })[];
}

export interface FeedbackReport {
  tab: "feedback";
  total: number;
  newCount: number;
  inReview: number;
  resolved: number;
  byCategory: { label: string; count: number }[];
  averageFirstReadHours: number | null;
  averageResolutionHours: number | null;
}

export type ReportData =
  | ActivityReport
  | AbsenceReport
  | NotificationsReport
  | ScoresReport
  | FeedbackReport;

export interface ReportView {
  range: ReportPeriodRange;
  scope: ReportScope;
  selectedScope: ReportScope;
  data: ReportData;
}
