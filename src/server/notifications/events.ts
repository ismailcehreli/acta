

//


// Add new notification types here first; the registry below defines their
// delivery defaults and whether users may disable them.

export const NOTIFICATION_EVENTS = {

  questionAsked: "question_asked",

  answerReceived: "answer_received",

  activityCancelled: "activity_cancelled",

  approvalPending: "approval_pending",

  activityApproved: "activity_approved",

  changesRequested: "changes_requested",
  activityRejected: "activity_rejected",

  approvalOverdue: "approval_overdue",

  answerOverdue: "answer_overdue",

  noActivityToday: "no_activity_today",

  managerNotFound: "manager_not_found",

  passwordReset: "password_reset",

  accountCreated: "account_created",

  absenceMarkedBySelf: "absence_marked_by_self",

  absenceRequestSubmitted: "absence_request_submitted",

  absenceRequestApproved: "absence_request_approved",

  absenceRequestRejected: "absence_request_rejected",

  feedbackStatusChanged: "feedback_status_changed",

  jobDelayed: "job_delayed",

  activityDeletionCode: "activity_deletion_code",
} as const;

export type NotificationEvent =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export type NotificationDeliveryChannel = "EMAIL" | "PUSH" | "BOTH";

export interface NotificationEventDetails {
  label: string;
  description: string;
  defaultChannel: NotificationDeliveryChannel;
  canDisable: boolean;
}


export const NOTIFICATION_EVENT_DETAILS: Record<
  NotificationEvent,
  NotificationEventDetails
> = {
  [NOTIFICATION_EVENTS.questionAsked]: {
    label: "A question was asked about your activity",
    description: "Notifies you when someone asks a question about one of your activities.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.answerReceived]: {
    label: "Your question was answered",
    description: "Notifies you when someone answers a question you asked.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityCancelled]: {
    label: "Activity cancelled",
    description: "Notifies you when the related activity is cancelled.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.approvalPending]: {
    label: "Activity awaiting approval",
    description: "Notifies you when a new activity requires your decision.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityApproved]: {
    label: "Activity approved",
    description: "Notifies you when your activity is approved.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.changesRequested]: {
    label: "Changes requested",
    description: "Notifies you when changes are requested for your activity.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityRejected]: {
    label: "Activity rejected",
    description: "Notifies you when your activity is rejected.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.approvalOverdue]: {
    label: "Approval overdue",
    description: "Notifies you when a pending approval exceeds its configured period.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.answerOverdue]: {
    label: "Answer overdue",
    description: "Notifies you when an unanswered question exceeds its configured period.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.noActivityToday]: {
    label: "No activity entered today",
    description: "Sends a reminder when no activity has been entered today.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.managerNotFound]: {
    label: "Manager not found",
    description: "Notifies you when no manager can be found for an activity.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.passwordReset]: {
    label: "Password reset",
    description: "Sends a password setup or reset link.",
    defaultChannel: "EMAIL",
    canDisable: false,
  },
  [NOTIFICATION_EVENTS.accountCreated]: {
    label: "New account details",
    description: "Sends a password setup link when a new account is created.",
    defaultChannel: "EMAIL",
    canDisable: false,
  },
  [NOTIFICATION_EVENTS.absenceMarkedBySelf]: {
    label: "Leave record created",
    description: "You can enable or disable this notification for older records.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.absenceRequestSubmitted]: {
    label: "Leave request received",
    description: "Notifies a manager when an employee submits a leave request.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.absenceRequestApproved]: {
    label: "Leave request approved",
    description: "Notifies you when your leave request is approved.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.absenceRequestRejected]: {
    label: "Leave request rejected",
    description: "Notifies you with the manager's explanation when your request is rejected.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.feedbackStatusChanged]: {
    label: "Feedback updated",
    description: "Notifies you when your feedback status or the manager's response changes.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityDeletionCode]: {
    label: "Activity deletion code",
    description:
      "Sends a confirmation code when the primary system administrator wants to delete an activity.",
    defaultChannel: "EMAIL",


    canDisable: false,
  },
  [NOTIFICATION_EVENTS.jobDelayed]: {
    label: "Scheduled job delayed",
    description: "Notifies you when a background job does not run within its expected interval.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
};

export function isKnownEvent(value: string): value is NotificationEvent {
  return Object.values(NOTIFICATION_EVENTS).includes(value as NotificationEvent);
}


export const URGENT_EVENTS: readonly string[] = [
  NOTIFICATION_EVENTS.passwordReset,


  NOTIFICATION_EVENTS.accountCreated,


  NOTIFICATION_EVENTS.jobDelayed,


  NOTIFICATION_EVENTS.activityDeletionCode,
];

export function isUrgentEvent(eventType: string): boolean {
  return URGENT_EVENTS.includes(eventType);
}


export const PUSH_EVENTS: readonly string[] = [
  NOTIFICATION_EVENTS.questionAsked,
  NOTIFICATION_EVENTS.answerReceived,
  NOTIFICATION_EVENTS.activityCancelled,
  NOTIFICATION_EVENTS.approvalPending,
  NOTIFICATION_EVENTS.activityApproved,
  NOTIFICATION_EVENTS.changesRequested,
  NOTIFICATION_EVENTS.activityRejected,
  NOTIFICATION_EVENTS.approvalOverdue,
  NOTIFICATION_EVENTS.answerOverdue,
  NOTIFICATION_EVENTS.noActivityToday,
  NOTIFICATION_EVENTS.absenceRequestSubmitted,
];

export function isPushEvent(eventType: string): boolean {
  return PUSH_EVENTS.includes(eventType);
}


export const ACTION_REQUIRED_EVENTS: readonly string[] = [
  NOTIFICATION_EVENTS.questionAsked,
  NOTIFICATION_EVENTS.approvalPending,
  NOTIFICATION_EVENTS.changesRequested,
  NOTIFICATION_EVENTS.approvalOverdue,
  NOTIFICATION_EVENTS.answerOverdue,
  NOTIFICATION_EVENTS.noActivityToday,
  NOTIFICATION_EVENTS.managerNotFound,
  NOTIFICATION_EVENTS.absenceRequestSubmitted,
];

export function isActionRequiredEvent(eventType: string): boolean {
  return ACTION_REQUIRED_EVENTS.includes(eventType);
}
