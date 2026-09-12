import { NOTIFICATION_EVENTS, isKnownEvent } from "./events";
import { jobLabelKey } from "@/server/jobs/labels";
import {
  createTranslator,
  DEFAULT_LOCALE,
  type Locale,
  type TranslateFunction,
} from "@/shared/i18n";



//




export interface NotificationLine {

  summary: string;

  path: string;
}

interface Payload {
  activityId?: unknown;
  conversationId?: unknown;
  activityTitle?: unknown;
  reason?: unknown;
  token?: unknown;
  jobName?: unknown;
  lagMinutes?: unknown;

  personName?: unknown;
  range?: unknown;
  approverName?: unknown;
  decisionRoute?: unknown;
  feedbackTitle?: unknown;
  feedbackStatus?: unknown;

  code?: unknown;
  title?: unknown;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function formatLocalizedJobLag(
  minutes: number | null,
  t: TranslateFunction,
): string {
  if (minutes === null) return t("notifications.templates.aLongTime");
  if (minutes < 60) {
    return t(
      minutes === 1
        ? "notifications.templates.delayMinute"
        : "notifications.templates.delayMinutes",
      { count: minutes },
    );
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t(
      hours === 1
        ? "notifications.templates.delayHour"
        : "notifications.templates.delayHours",
      { count: hours },
    );
  }

  const days = Math.floor(hours / 24);
  return t(
    days === 1
      ? "notifications.templates.delayDay"
      : "notifications.templates.delayDays",
    { count: days },
  );
}

function activityPath(payload: Payload): string {
  const id = payload.activityId;
  return typeof id === "string" ? `/activities/${id}` : "/";
}

/**
 * Render one line for an event. Unknown events are **not silently dropped**: the
 * event name is shown and the user is sent to the application instead of seeing
 * an empty notification.
 */
export function renderLine(
  eventType: string,
  payload: unknown,
  locale: Locale = DEFAULT_LOCALE,
): NotificationLine {
  const t = createTranslator(locale);
  const data = (payload ?? {}) as Payload;
  const title = text(data.activityTitle, t("notifications.fallbacks.activity"));

  if (!isKnownEvent(eventType)) {
    return {
      summary: t("notifications.templates.unknown", { eventType }),
      path: "/",
    };
  }

  switch (eventType) {
    case NOTIFICATION_EVENTS.questionAsked:
      return {
        summary: t("notifications.templates.questionAsked"),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.answerReceived:
      return {
        summary: t("notifications.templates.answerReceived"),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.activityCancelled:
      return {
        summary: t("notifications.templates.activityCancelled", { title }),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.approvalPending:
      return {
        summary: t("notifications.templates.approvalPending"),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.activityApproved:
      return {
        summary: t("notifications.templates.activityApproved", { title }),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.changesRequested:
      return {
        // The reason never enters email: content is not carried in mail (§12.3);
        // the person reads it on screen.
        summary: t("notifications.templates.changesRequested", { title }),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.activityRejected:
      return {
        // The reason is read on screen; email does not carry record content (§12.3).
        summary: t("notifications.templates.activityRejected", { title }),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.approvalOverdue:
      return {
        summary: t("notifications.templates.approvalOverdue"),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.answerOverdue:
      return {
        summary: t("notifications.templates.answerOverdue"),
        path: activityPath(data),
      };
    case NOTIFICATION_EVENTS.noActivityToday:
      return {
        summary: t("notifications.templates.noActivityToday"),
        path: "/activities/new",
      };
    case NOTIFICATION_EVENTS.managerNotFound:
      return {
        summary: t("notifications.templates.managerNotFound", { title }),
        path: "/",
      };
    case NOTIFICATION_EVENTS.jobDelayed: {
      const jobName = typeof data.jobName === "string"
        ? t(jobLabelKey(data.jobName))
        : t("notifications.fallbacks.job");
      const delay = formatLocalizedJobLag(
        typeof data.lagMinutes === "number" ? data.lagMinutes : null,
        t,
      );
      return {
        summary: t("notifications.templates.jobDelayed", { jobName, delay }),
        path: "/admin/jobs",
      };
    }
    case NOTIFICATION_EVENTS.accountCreated: {
      const token = typeof data.token === "string" ? data.token : "";
      return {
        summary: t("notifications.templates.accountCreated"),
        path: `/reset/${encodeURIComponent(token)}`,
      };
    }
    case NOTIFICATION_EVENTS.absenceMarkedBySelf: {
      const person = text(data.personName, t("notifications.fallbacks.person"));
      const range = text(data.range, "");
      return {
        summary: t("notifications.templates.absenceMarkedBySelf", { person, range }),
        path: "/team/absence",
      };
    }
    case NOTIFICATION_EVENTS.absenceRequestSubmitted: {
      const person = text(data.personName, t("notifications.fallbacks.employee"));
      const range = text(data.range, "");
      return {
        summary: t("notifications.templates.absenceRequestSubmitted", { person, range }),
        path: "/team/absence",
      };
    }
    case NOTIFICATION_EVENTS.absenceRequestApproved: {
      const range = text(data.range, "");
      const approver = text(data.approverName, t("notifications.fallbacks.manager"));
      return {
        summary: t("notifications.templates.absenceRequestApproved", { approver, range }),
        path: "/absence",
      };
    }
    case NOTIFICATION_EVENTS.absenceRequestRejected: {
      const range = text(data.range, "");
      const rejector = text(data.approverName, t("notifications.fallbacks.manager"));
      return {
        summary: t("notifications.templates.absenceRequestRejected", { rejector, range }),
        path: "/absence",
      };
    }
    case NOTIFICATION_EVENTS.feedbackStatusChanged: {
      const title = text(data.feedbackTitle, t("notifications.fallbacks.feedback"));
      const status = text(data.feedbackStatus, t("notifications.fallbacks.updated"));
      return {
        summary: t("notifications.templates.feedbackStatusChanged", { title, status }),
        path: "/feedback",
      };
    }
    case NOTIFICATION_EVENTS.activityDeletionCode: {
      const code = typeof data.code === "string" ? data.code : "";
      const title = typeof data.title === "string" ? data.title : "";
      return {
        summary: t("notifications.templates.activityDeletionCode", { code, title }),
        // Do not link directly to the deletion screen: clicking a link must not
        // replace the deliberate code-based safeguard.
        path: "/admin/activity-deletion",
      };
    }
    case NOTIFICATION_EVENTS.passwordReset: {
      const token = typeof data.token === "string" ? data.token : "";
      return {
        summary: t("notifications.templates.passwordReset"),
        path: `/reset/${encodeURIComponent(token)}`,
      };
    }
  }
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * Render an email for one person. Notifications accumulated in a short interval
 * are combined into **one email** (§12.3); one email per event becomes unreadable.
 */
export function renderEmail(
  lines: NotificationLine[],
  options: { baseUrl: string; digest: boolean; locale?: Locale },
): RenderedEmail {
  const t = createTranslator(options.locale ?? DEFAULT_LOCALE);
  const subject =
    lines.length === 1 && !options.digest
      ? t("notifications.templates.emailSubject")
      : options.digest
        ? t("notifications.templates.emailDigestSubject", { count: lines.length })
        : t("notifications.templates.emailMultipleSubject", { count: lines.length });

  const body = lines
    .map((line) => `- ${line.summary}\n  ${options.baseUrl}${line.path}`)
    .join("\n\n");

  const text = [
    options.digest
      ? t("notifications.templates.emailDigestIntro")
      : t("notifications.templates.emailSingleIntro"),
    "",
    body,
    "",
    t("notifications.templates.emailFooter"),
  ].join("\n");

  return { subject, text };
}
