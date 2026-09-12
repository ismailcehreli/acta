import type { ZodIssue } from "zod";

import type { TranslateFunction, TranslationValues } from "./types";

/**
 * A message produced by a domain service.
 *
 * Services do not know the request locale. They can keep an English fallback
 * for logs and non-HTTP callers while exposing a stable translation key and
 * interpolation values to the boundary that renders the message.
 */
export interface LocalizableMessage {
  message?: string;
  messageKey?: string;
  messageValues?: TranslationValues;
}

export function localizeMessage(
  t: TranslateFunction,
  message: LocalizableMessage,
): string {
  if (message.messageKey) {
    const translated = t(message.messageKey, message.messageValues);
    if (translated !== message.messageKey) return translated;
  }

  return message.message ?? t("common.operationFailed");
}

/**
 * Localizes a result that exposes a stable domain error code. The convention
 * keeps service modules independent from i18n: `activity_not_found` in the
 * activity domain resolves to `errors.activity.activityNotFound`.
 */
export function localizeServiceMessage(
  t: TranslateFunction,
  domain: string,
  result: LocalizableMessage & { error?: string; reason?: string },
): string {
  if (result.messageKey) return localizeMessage(t, result);

  const errorCode = result.error ?? result.reason;
  if (errorCode) {
    const key = `errors.${domain}.${toCamelCase(errorCode)}`;
    const translated = t(key, result.messageValues);
    if (translated !== key) return translated;
  }

  return result.message ?? t("common.operationFailed");
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
}

const EXACT_VALIDATION_KEYS: Record<string, string> = {
  "Email address is required": "validation.emailRequired",
  "Email address is too long": "validation.emailTooLong",
  "Enter a valid email address": "validation.invalidEmail",
  "Password must be at least 10 characters": "validation.passwordMin",
  "Password must be 200 characters or fewer": "validation.passwordMax",
  "Password is required": "validation.passwordRequired",
  "Title is required": "validation.titleRequired",
  "Description is required": "validation.descriptionRequired",
  "Current password is required": "validation.currentPasswordRequired",
  "Passwords do not match": "validation.passwordsDoNotMatch",
  "Passwords must match": "validation.passwordsMustMatch",
  "Cancellation reason is required": "validation.cancellationReasonRequired",
  "Reason must be 1000 characters or fewer": "validation.reasonMax1000",
  "Reason must be 500 characters or fewer": "validation.reasonMax500",
  "Select at least one working day": "validation.workingDayRequired",
  "A working day cannot be selected more than once":
    "validation.workingDayDuplicate",
  "Workday end must be after workday start": "validation.workdayEndAfterStart",
  "Choose a date in DD.MM.YYYY format": "validation.invalidCalendarDate",
  "Holiday description is required": "validation.holidayDescriptionRequired",
  "Description must be 150 characters or fewer": "validation.descriptionMax150",
  "Invalid date format": "validation.invalidDateFormat",
  "Select at least one unit": "validation.unitRequired",
  "Select at least one related department": "validation.relatedDepartmentRequired",
  "A department cannot be selected more than once":
    "validation.relatedDepartmentDuplicate",
  "At most 50 units can be classified in one operation":
    "validation.unitLimit",
  "A unit cannot be submitted more than once": "validation.unitDuplicate",
  "Select a unit": "validation.selectUnit",
  "Select a reason": "validation.selectReason",
  "Unit name must be at least 2 characters": "validation.unitNameMin",
  "Unit name must be 150 characters or fewer": "validation.unitNameMax",
  "Unit type must be at least 2 characters": "validation.unitTypeMin",
  "Unit type must be 50 characters or fewer": "validation.unitTypeMax",
  "Invalid unit ID": "validation.invalidUnitId",
  "Page path is too long": "validation.pagePathTooLong",
  "Response must be 5,000 characters or fewer": "validation.responseMax5000",
  "Response cannot contain HTML tags": "validation.responseHtml",
  "The port must be between 1 and 65535": "validation.portRange",
  "Port must be an integer": "validation.portInteger",
  "Server address is required": "validation.serverAddressRequired",
  "Server address must be 255 characters or fewer":
    "validation.serverAddressMax",
  "Sender address is required": "validation.senderAddressRequired",
  "Sender address must be 255 characters or fewer":
    "validation.senderAddressMax",
  "Reason name must be at least 2 characters": "validation.reasonNameMin",
  "The reason name must be at least 2 characters": "validation.reasonNameMin",
  "Reason name cannot exceed 120 characters": "validation.reasonNameMax",
  "The reason name cannot exceed 120 characters": "validation.reasonNameMax",
  "Full name must be at least 3 characters": "validation.fullNameMin",
  "Full name must be 150 characters or fewer": "validation.fullNameMax",
  "Title must be 100 characters or fewer": "validation.titleMax100",
  "Closing reason is required": "validation.closingReasonRequired",
  "Note must be 500 characters or fewer": "validation.noteMax500",
  "A reason is required to reject a leave request":
    "validation.rejectionReasonRequired",
  "Message cannot be empty": "validation.messageRequired",
  "Message must be 10,000 characters or fewer": "validation.messageMax10000",
  "Note must be 1,000 characters or fewer": "validation.noteMax1000",
  "Next step must be 500 characters or fewer": "validation.nextStepMax500",
  "Invalid date": "validation.invalidDate",
  "Closing note is required": "validation.closingNoteRequired",
  "Reason for reopening is required": "validation.reopeningReasonRequired",
  "Select an assignee": "validation.assigneeRequired",
  "Search must be 200 characters or fewer": "validation.searchMax200",
  "Subscription endpoint is too long": "validation.subscriptionEndpointMax",
  "Subscription endpoint is invalid": "validation.subscriptionEndpointInvalid",
  "Key format is invalid": "validation.keyFormat",
};

/**
 * Converts a Zod issue into a localized message at the application boundary.
 * Unknown issues intentionally become a safe generic message instead of
 * leaking Zod's English implementation text to the user.
 */
export function localizeValidationIssue(
  t: TranslateFunction,
  issue: ZodIssue | undefined,
  fallbackKey = "common.invalidInput",
): string {
  if (!issue) return t(fallbackKey);

  const exactKey = EXACT_VALIDATION_KEYS[issue.message];
  if (exactKey) return t(exactKey);

  const dynamicRules: Array<{
    pattern: RegExp;
    key: string;
    valueName: string;
  }> = [
    {
      pattern: /^Title must be at least (\d+) characters$/,
      key: "validation.titleMin",
      valueName: "count",
    },
    {
      pattern: /^Title must be (\d+) characters or fewer$/,
      key: "validation.titleMax",
      valueName: "count",
    },
    {
      pattern: /^Description must be at least (\d+) characters$/,
      key: "validation.descriptionMin",
      valueName: "count",
    },
    {
      pattern: /^Description must be ([\d,]+) characters or fewer$/,
      key: "validation.descriptionMax",
      valueName: "count",
    },
    {
      pattern: /^At most (\d+) related departments can be selected$/,
      key: "validation.relatedDepartmentsMax",
      valueName: "count",
    },
    {
      pattern: /^(.+) cannot be empty$/,
      key: "validation.fieldRequired",
      valueName: "field",
    },
    {
      pattern: /^(.+) must be (\d+) characters or fewer$/,
      key: "validation.fieldMax",
      valueName: "fieldMax",
    },
    {
      pattern: /^(.+) cannot contain HTML tags$/,
      key: "validation.fieldHtml",
      valueName: "field",
    },
  ];

  for (const rule of dynamicRules) {
    const match = issue.message.match(rule.pattern);
    if (!match) continue;

    if (rule.valueName === "fieldMax") {
      return t(rule.key, {
        field: localizeFieldName(t, match[1] ?? "Field"),
        count: match[2] ?? "",
      });
    }

    const value =
      rule.valueName === "field"
        ? localizeFieldName(t, match[1] ?? "Field")
        : match[1] ?? "";
    return t(rule.key, { [rule.valueName]: value });
  }

  return t(fallbackKey);
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  Category: "validation.fields.category",
  Title: "validation.fields.title",
  Description: "validation.fields.description",
  Answer: "validation.fields.answer",
  Response: "validation.fields.response",
  "Page path": "validation.fields.sourcePath",
  Note: "validation.fields.note",
  "Next step": "validation.fields.nextStep",
};

function localizeFieldName(t: TranslateFunction, field: string): string {
  const key = FIELD_LABEL_KEYS[field];
  return key ? t(key) : field;
}
