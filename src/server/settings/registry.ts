import { formatDomainList, parseDomainList } from "./email-domains";
import {
  NOTIFICATION_EVENT_DETAILS,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "../notifications/events";
import type { TranslationKey } from "@/shared/i18n";



//



//



export type SettingType =
  | "number"
  | "boolean"
  | "time"
  | "domains"
  | "select";

export interface SettingOption {
  value: string;
  label: string;
  /** Optional message key used by the settings UI. */
  labelKey?: TranslationKey | string;
}

export interface SettingDefinition {
  key: string;

  group: string;
  label: string;
  description: string;
  /** Optional message keys; server validation keeps English fallbacks. */
  labelKey?: TranslationKey | string;
  descriptionKey?: TranslationKey | string;
  type: SettingType;

  defaultValue: string;

  min?: number;
  max?: number;

  unit?: string;
  unitKey?: TranslationKey | string;

  placeholder?: string;
  placeholderKey?: TranslationKey | string;

  options?: readonly SettingOption[];
}

export const SETTING_KEYS = {

  retroactiveEntryDays: "retroactive_entry_days",

  editWindowMinutes: "edit_window_minutes",

  readDwellSeconds: "read_dwell_seconds",

  supervisorTakeoverBusinessDays: "supervisor_takeover_business_days",

  overdueAnswerBusinessDays: "overdue_answer_business_days",

  pendingApprovalBusinessDays: "pending_approval_business_days",

  dailyDigestHour: "daily_digest_hour",

  attachmentMaxMb: "attachment_max_mb",
  attachmentMaxCount: "attachment_max_count",

  managerParticipationSummary: "manager_participation_summary",

  sessionHours: "session_hours",

  rememberMeDays: "remember_me_days",

  lockoutMinutes: "lockout_minutes",

  allowedEmailDomains: "allowed_email_domains",

  followUpStaleBusinessDays: "follow_up_stale_business_days",

  activityTitleMinChars: "activity_title_min_chars",
  activityTitleMaxChars: "activity_title_max_chars",
  activityDescriptionMinChars: "activity_description_min_chars",
  activityDescriptionMaxChars: "activity_description_max_chars",

  selfAbsenceMaxDays: "self_absence_max_days",

  scoringEnabled: "scoring_enabled",
  scoringDeclinePeriods: "scoring_decline_periods",

  scoringWeightRegularity: "scoring_weight_regularity",
  scoringWeightAcceptance: "scoring_weight_acceptance",
  scoringWeightApproval: "scoring_weight_approval",
  scoringWeightFollowUp: "scoring_weight_follow_up",
  scoringAppreciationPoints: "scoring_appreciation_points",
  scoringRankingEnabled: "scoring_ranking_enabled",
  appreciationEnabled: "appreciation_enabled",

  jobDelayAlertEnabled: "job_delay_alert_enabled",
  jobDelayAlertRepeatHours: "job_delay_alert_repeat_hours",

  backupMonitoringEnabled: "backup_monitoring_enabled",

  noActivityReminderLeadMinutes: "no_activity_reminder_lead_minutes",
} as const;


export const ACTIVITY_TITLE_COLUMN_MAX = 150;
export const ACTIVITY_DESCRIPTION_COLUMN_MAX = 10_000;


export interface SettingPairRule {

  min: string;

  max: string;

  message: string;
  messageKey: string;
}

export const SETTING_PAIR_RULES: SettingPairRule[] = [
  {
    min: SETTING_KEYS.activityTitleMinChars,
    max: SETTING_KEYS.activityTitleMaxChars,
    message:
      "The minimum character count for title cannot exceed the maximum.",
    messageKey: "errors.settings.pairTitleInvalid",
  },
  {
    min: SETTING_KEYS.activityDescriptionMinChars,
    max: SETTING_KEYS.activityDescriptionMaxChars,
    message:
      "The minimum character count for description cannot exceed the maximum.",
    messageKey: "errors.settings.pairDescriptionInvalid",
  },
];

/**
 * Setting sets whose sum must remain constant (Task 11.10, audit 23.08.2026 finding 8).
 *
 * Base score cap is 100 for every profile. Appreciation contribution is outside this base total.
 */
export interface SettingSumRule {
  keys: string[];
  total: number;
  message: string;
  messageKey: string;
}

export const SETTING_SUM_RULES: SettingSumRule[] = [
  {
    keys: [
      SETTING_KEYS.scoringWeightRegularity,
      SETTING_KEYS.scoringWeightAcceptance,
      SETTING_KEYS.scoringWeightFollowUp,
    ],
    total: 100,
    message:
      "Sum of weights for employee profile requiring approval must equal 100: regularity + acceptance + follow-up.",
    messageKey: "errors.settings.sumEmployeeInvalid",
  },
  {
    keys: [
      SETTING_KEYS.scoringWeightRegularity,
      SETTING_KEYS.scoringWeightApproval,
      SETTING_KEYS.scoringWeightFollowUp,
    ],
    total: 100,
    message:
      "Sum of weights for manager profile must equal 100: regularity + approval duration + follow-up.",
    messageKey: "errors.settings.sumManagerInvalid",
  },
];

const STATIC_SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: SETTING_KEYS.scoringEnabled,
    group: "Score",
    label: "Enable scoring",
    description:
      "When disabled, scores are hidden throughout the application. When enabled, users can view their own scores and managers can view team scores.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.scoringDeclinePeriods,
    group: "Score",
    label: "Decline warning threshold",
    description:
      "Number of consecutive declining periods before a warning appears beside a person. Smaller values warn earlier; larger values require a longer trend.",
    type: "number",
    defaultValue: "3",
    min: 2,
    max: 12,
    unit: "periods",
  },
  {
    key: SETTING_KEYS.scoringWeightRegularity,
    group: "Score",
    label: "Reporting regularity weight",
    description:
      "Share of the score assigned to reporting regularity. For employees whose activities do not require approval, the acceptance-rate share is added to this section.",
    type: "number",
    defaultValue: "60",
    min: 0,
    max: 100,
    unit: "points",
  },
  {
    key: SETTING_KEYS.scoringWeightAcceptance,
    group: "Score",
    label: "Acceptance rate weight",
    description:
      "Weight assigned to the share of approved records. Used only for employees whose activities require approval.",
    type: "number",
    defaultValue: "30",
    min: 0,
    max: 100,
    unit: "points",
  },
  {
    key: SETTING_KEYS.scoringWeightApproval,
    group: "Score",
    label: "Approval time weight",
    description:
      "Weight assigned to a manager deciding records on time. Rejections count as decisions too.",
    type: "number",
    defaultValue: "30",
    min: 0,
    max: 100,
    unit: "points",
  },
  {
    key: SETTING_KEYS.scoringWeightFollowUp,
    group: "Score",
    label: "Follow-up discipline weight",
    description:
      "Share of the score assigned to answering questions and completing follow-up items. The same value applies to all three profiles.",
    type: "number",
    defaultValue: "10",
    min: 0,
    max: 100,
    unit: "points",
  },
  {
    key: SETTING_KEYS.scoringAppreciationPoints,
    group: "Score",
    label: "Points per appreciation",
    description:
      "Points added to the overall score for each valid appreciation given to an approved activity. Appreciations can still be given when this is 0, but they add no points.",
    type: "number",
    defaultValue: "1",
    min: 0,
    max: 10,
    unit: "points",
  },
  {
    key: SETTING_KEYS.scoringRankingEnabled,
    group: "Score",
    label: "Enable ranking tab",
    description:
      "When enabled, the team scores screen offers sorting by score. When disabled, the list is alphabetical; there is never a company-wide ranking.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.appreciationEnabled,
    group: "Score",
    label: "Enable appreciations",
    description:
      "When enabled, authorized users can appreciate activities. Each appreciation contributes the configured number of points to the overall score and is shown beside the activity.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.selfAbsenceMaxDays,
    group: "Leave and no-activity days",
    label: "Maximum self-entered leave period",
    description:
      "Maximum leave or no-activity period a person can enter for themselves at once. A manager can enter a longer period.",
    type: "number",
    defaultValue: "30",
    min: 1,
    max: 365,
    unit: "days",
  },
  {
    key: SETTING_KEYS.activityTitleMinChars,
    group: "Activity entry",
    label: "Minimum title length",
    description:
      "Minimum number of characters required for a title. The default of 1 prevents empty titles while allowing short titles.",
    type: "number",
    defaultValue: "1",
    min: 1,
    max: 100,
    unit: "characters",
  },
  {
    key: SETTING_KEYS.activityTitleMaxChars,
    group: "Activity entry",
    label: "Maximum title length",
    description:
      "Maximum number of characters allowed in a title. The limit cannot exceed the database column's 150-character capacity.",
    type: "number",
    defaultValue: "150",
    min: 10,
    max: ACTIVITY_TITLE_COLUMN_MAX,
    unit: "characters",
  },
  {
    key: SETTING_KEYS.activityDescriptionMinChars,
    group: "Activity entry",
    label: "Minimum description length",
    description:
      "Minimum number of characters required for a description. The default of 1 prevents an empty description.",
    type: "number",
    defaultValue: "1",
    min: 1,
    max: 1000,
    unit: "characters",
  },
  {
    key: SETTING_KEYS.activityDescriptionMaxChars,
    group: "Activity entry",
    label: "Maximum description length",
    description:
      "Maximum number of characters allowed in a description. The limit cannot exceed the database column's 10,000-character capacity.",
    type: "number",
    defaultValue: "10000",
    min: 100,
    max: ACTIVITY_DESCRIPTION_COLUMN_MAX,
    unit: "characters",
  },
  {
    key: SETTING_KEYS.retroactiveEntryDays,
    group: "Activity entry",
    label: "Backdated entry window",
    description:
      "Number of days into the past for which a user can enter an activity. Older dates are not accepted.",
    type: "number",
    defaultValue: "1",
    min: 0,
    max: 90,
    unit: "days",
  },
  {
    key: SETTING_KEYS.editWindowMinutes,
    group: "Activity entry",
    label: "Revision window",
    description:
      "Number of minutes during which a record can be revised after creation. Revision closes as soon as the record is read, even if time remains.",
    type: "number",
    defaultValue: "15",
    min: 0,
    max: 1440,
    unit: "minutes",
  },
  {
    key: SETTING_KEYS.readDwellSeconds,
    group: "Activity entry",
    label: "Read dwell time",
    description:
      "Number of seconds the detail screen must remain open before a record is marked read. Quickly passing through a list does not count.",
    type: "number",
    defaultValue: "2",
    min: 1,
    max: 60,
    unit: "seconds",
  },
  {
    key: SETTING_KEYS.pendingApprovalBusinessDays,
    group: "Approval flow",
    label: "Approval reminder",
    description:
      "Number of business days before a pending approval reminder is sent. Weekends and public holidays are excluded; this also affects the approval-time score.",
    type: "number",
    defaultValue: "2",
    min: 1,
    max: 30,
    unit: "business days",
  },
  {
    key: SETTING_KEYS.followUpStaleBusinessDays,
    group: "Follow-up items",
    label: "Follow-up inactivity threshold",
    description:
      "Number of business days of inactivity before a follow-up item is flagged. The same period determines whether the item was handled on time for scoring.",
    type: "number",
    defaultValue: "5",
    min: 1,
    max: 60,
    unit: "business days",
  },
  {
    key: SETTING_KEYS.supervisorTakeoverBusinessDays,
    group: "Questions and answers",
    label: "Supervisor takeover window",
    description:
      "Number of business days of inactivity before the supervisor can close a conversation. This affects only the permission to close the conversation.",
    type: "number",
    defaultValue: "10",
    min: 1,
    max: 60,
    unit: "business days",
  },
  {
    key: SETTING_KEYS.overdueAnswerBusinessDays,
    group: "Questions and answers",
    label: "No-activity reminder",
    description:
      "Number of business days before a reminder is sent for an unanswered question. The same period determines whether the answer was on time for scoring.",
    type: "number",
    defaultValue: "3",
    min: 1,
    max: 30,
    unit: "business days",
  },
  {
    key: SETTING_KEYS.dailyDigestHour,
    group: "Notifications",
    label: "Daily digest hour",
    description:
      "Hour at which the daily digest is sent to users who selected it. The hour uses the company's local time.",
    type: "time",
    defaultValue: "18",
    min: 0,
    max: 23,
    unit: ":00",
  },
  {
    key: SETTING_KEYS.noActivityReminderLeadMinutes,
    group: "Notifications",
    label: "No-activity reminder lead time",
    description:
      "Number of minutes before the end of working hours when the no-activity reminder is sent. With 0, the reminder is sent at the end of working hours.",
    type: "number",
    defaultValue: "60",
    min: 0,
    max: 180,
    unit: "minutes",
  },
  {
    key: SETTING_KEYS.managerParticipationSummary,
    group: "Notifications",
    label: "Manager participation digest",
    description:
      "When enabled, managers receive a digest showing how many people on their team entered an activity that day. When disabled, this digest is not sent.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.attachmentMaxMb,
    group: "File attachments",
    label: "Maximum file size",
    description:
      "Maximum size of one attachment in MB. Larger files cannot be uploaded.",
    type: "number",
    defaultValue: "25",
    min: 1,
    max: 200,
    unit: "MB",
  },
  {
    key: SETTING_KEYS.attachmentMaxCount,
    group: "File attachments",
    label: "Maximum attachment count",
    description:
      "Maximum number of files that can be attached to an activity. Additional files are rejected after this limit.",
    type: "number",
    defaultValue: "5",
    min: 1,
    max: 20,
    unit: "files",
  },
  {
    key: SETTING_KEYS.allowedEmailDomains,
    group: "User accounts",
    label: "Allowed email domains",
    description:
      "Enter the domains accepted for new accounts and address changes, separated by commas. Leave blank for no restriction; existing accounts are unaffected.",
    type: "domains",
    defaultValue: "",
    placeholder: "example.com, example.org",
  },
  {
    key: SETTING_KEYS.rememberMeDays,
    group: "Sessions and security",
    label: "Remember-me duration",
    description:
      "How many days a session remains active when Remember me is selected at sign-in. With 0, this option is hidden on the sign-in screen.",
    type: "number",
    defaultValue: "30",
    min: 0,
    max: 90,
    unit: "days",
  },
  {
    key: SETTING_KEYS.sessionHours,
    group: "Sessions and security",
    label: "Session lifetime",
    description:
      "How many hours after sign-in a session expires. The user must enter their password again after expiration.",
    type: "number",
    defaultValue: "12",
    min: 1,
    max: 168,
    unit: "hours",
  },
  {
    key: SETTING_KEYS.lockoutMinutes,
    group: "Sessions and security",
    label: "Account lockout duration",
    description:
      "How many minutes an account is locked after ten consecutive incorrect passwords. A password-reset link clears the lock without waiting.",
    type: "number",
    defaultValue: "15",
    min: 1,
    max: 1440,
    unit: "minutes",
  },
  {
    key: SETTING_KEYS.jobDelayAlertEnabled,
    group: "Notifications",
    label: "Delay alerts",
    description:
      "Whether system administrators receive an alert when a scheduled job does not run within its expected interval.",
    type: "boolean",
    defaultValue: "true",
  },
  {
    key: SETTING_KEYS.jobDelayAlertRepeatHours,
    group: "Notifications",
    label: "Delay alert repeat interval",
    description:
      "How often an alert is repeated while the same job remains delayed. The minimum is 1 hour.",
    type: "number",
    defaultValue: "24",
    min: 1,
    max: 168,
    unit: "hours",
  },
  {
    key: SETTING_KEYS.backupMonitoringEnabled,
    group: "Notifications",
    label: "Backup monitoring",
    description:
      "Enables alerts when the backup job is delayed. The system enables this automatically after the first successful backup.",
    type: "boolean",
    defaultValue: "false",
  },
];

function settingDefinitionKey(
  settingKey: string,
  field: "label" | "description" | "placeholder",
): string {
  return `screens.settingsDefinitions.${settingKey}.${field}`;
}

function settingUnitKey(unit: string): string {
  return `screens.settingsDefinitions.units.${unit}`;
}

/**
 * Attach presentation keys without putting locale-specific behavior in the
 * settings service. The English label/description remain useful for server
 * logs and non-HTTP callers; the UI always prefers these keys.
 */
const LOCALIZED_STATIC_SETTING_DEFINITIONS = STATIC_SETTING_DEFINITIONS.map(
  (definition) => ({
    ...definition,
    labelKey: settingDefinitionKey(definition.key, "label"),
    descriptionKey: settingDefinitionKey(definition.key, "description"),
    unitKey: definition.unit ? settingUnitKey(definition.unit) : undefined,
    placeholderKey: definition.placeholder
      ? settingDefinitionKey(definition.key, "placeholder")
      : undefined,
  }),
);

export const NOTIFICATION_SETTING_PREFIX = "notification_";

export function notificationEnabledKey(event: NotificationEvent): string {
  return `${NOTIFICATION_SETTING_PREFIX}${event}_enabled`;
}

export function notificationChannelKey(event: NotificationEvent): string {
  return `${NOTIFICATION_SETTING_PREFIX}${event}_channel`;
}

export const NOTIFICATION_CHANNEL_OPTIONS: readonly SettingOption[] = [
  {
    value: "EMAIL",
    label: "Email",
    labelKey: "screens.settingsOptions.notificationChannels.EMAIL",
  },
  {
    value: "PUSH",
    label: "Browser notification",
    labelKey: "screens.settingsOptions.notificationChannels.PUSH",
  },
  {
    value: "BOTH",
    label: "Email and browser notification",
    labelKey: "screens.settingsOptions.notificationChannels.BOTH",
  },
];

const REQUIRED_NOTIFICATION_CHANNEL_OPTIONS: readonly SettingOption[] =
  NOTIFICATION_CHANNEL_OPTIONS.filter((option) => option.value !== "PUSH");

function notificationSettingDefinitions(): SettingDefinition[] {
  return (Object.values(NOTIFICATION_EVENTS) as NotificationEvent[]).flatMap(
    (event) => {
      const details = NOTIFICATION_EVENT_DETAILS[event];
      const definitions: SettingDefinition[] = [];

      if (details.canDisable) {
        definitions.push({
          key: notificationEnabledKey(event),
          group: "Notifications",
          label: details.label,
          description: details.description,
          labelKey: `screens.notificationEvents.${event}.label`,
          descriptionKey: `screens.notificationEvents.${event}.description`,
          type: "boolean",
          defaultValue: "true",
        });
      }

      definitions.push({
        key: notificationChannelKey(event),
        group: "Notifications",
        label: `${details.label} channel`,
        description: details.canDisable
          ? "Choose the channel used to send this notification."
          : `${details.description} This notification cannot be disabled.`,
        labelKey: `screens.notificationEvents.${event}.channelLabel`,
        descriptionKey: details.canDisable
          ? "screens.settingsDefinitions.notificationChannelDescription"
          : "screens.settingsDefinitions.notificationRequiredChannelDescription",
        type: "select",
        defaultValue: details.defaultChannel,
        // Events carrying password links cannot be left without email. Push
        // cannot deliver the link to a new account or an unsubscribed user,
        // so email or both channels are required.
        options: details.canDisable
          ? NOTIFICATION_CHANNEL_OPTIONS
          : REQUIRED_NOTIFICATION_CHANNEL_OPTIONS,
      });

      return definitions;
    },
  );
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  ...LOCALIZED_STATIC_SETTING_DEFINITIONS,
  ...notificationSettingDefinitions(),
];

export const SETTING_GROUPS = [
  "Activity entry",
  // Approval flow is a Version 1 feature; keep its settings under their own group.
  "Approval flow",
  "Questions and answers",
  "Follow-up items",
  // Self-entered leave is supported; keep the group boundary explicit here.
  "Leave and no-activity days",
  "Notifications",
  "File attachments",
  "User accounts",
  "Score",
  "Sessions and security",
] as const;

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function findSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export type SettingValidation =
  | { ok: true; value: string }
  | {
      ok: false;
      message: string;
      messageKey?: string;
      messageValues?: Record<string, string | number>;
    };

/** Validates a setting value against its type and bounds. */
export function validateSettingValue(
  definition: SettingDefinition,
  raw: string,
): SettingValidation {
  const trimmed = raw.trim();

  if (definition.type === "domains") {
    const list = parseDomainList(trimmed);
    if (!list.ok) {
      return {
        ok: false,
        message: `${definition.label}: ${list.message}`,
        messageKey: "errors.emailDomains.invalidDomain",
        messageValues: { domain: list.domain },
      };
    }
    return { ok: true, value: formatDomainList(list.domains) };
  }

  if (definition.type === "boolean") {
    if (trimmed !== "true" && trimmed !== "false") {
      return {
        ok: false,
        message: `${definition.label}: value must be true or false.`,
        messageKey: "errors.settings.boolean",
        messageValues: { label: definition.label },
      };
    }
    return { ok: true, value: trimmed };
  }

  if (definition.type === "select") {
    const options = definition.options ?? [];
    if (!options.some((option) => option.value === trimmed)) {
      return {
        ok: false,
        message: `${definition.label}: choose a valid option.`,
        messageKey: "errors.settings.option",
        messageValues: { label: definition.label },
      };
    }
    return { ok: true, value: trimmed };
  }

  const count = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(count) || !Number.isInteger(count)) {
    return {
      ok: false,
      message: `${definition.label}: enter a whole number.`,
      messageKey: "errors.settings.wholeNumber",
      messageValues: { label: definition.label },
    };
  }

  if (definition.min !== undefined && count < definition.min) {
    return {
      ok: false,
      message: `${definition.label}: must be at least ${definition.min}.`,
      messageKey: "errors.settings.minimum",
      messageValues: { label: definition.label, count: definition.min },
    };
  }

  if (definition.max !== undefined && count > definition.max) {
    return {
      ok: false,
      message: `${definition.label}: must be at most ${definition.max}.`,
      messageKey: "errors.settings.maximum",
      messageValues: { label: definition.label, count: definition.max },
    };
  }

  return { ok: true, value: String(count) };
}
