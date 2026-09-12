import {
  DEFAULT_LOCALE,
  LOCALE_LANGUAGE_TAGS,
  type Locale,
} from "@/shared/i18n/config";
import { createTranslator } from "@/shared/i18n/translator";

/** The company time zone used for all timestamp calculations and displays. */
export const COMPANY_TIME_ZONE = "Europe/Istanbul";

interface Formatters {
  day: Intl.DateTimeFormat;
  dayLong: Intl.DateTimeFormat;
  dayShort: Intl.DateTimeFormat;
  instantDate: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  instantShortDate: Intl.DateTimeFormat;
  second: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
}

const formatterCache = new Map<Locale, Formatters>();

function getFormatters(locale: Locale = DEFAULT_LOCALE): Formatters {
  const cached = formatterCache.get(locale);
  if (cached) return cached;

  const language =
    LOCALE_LANGUAGE_TAGS[locale] ?? LOCALE_LANGUAGE_TAGS[DEFAULT_LOCALE];
  const formatters: Formatters = {
    day: new Intl.DateTimeFormat(language, {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    dayLong: new Intl.DateTimeFormat(language, {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
      weekday: "long",
    }),
    dayShort: new Intl.DateTimeFormat(language, {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    }),
    instantDate: new Intl.DateTimeFormat(language, {
      timeZone: COMPANY_TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    time: new Intl.DateTimeFormat(language, {
      timeZone: COMPANY_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    instantShortDate: new Intl.DateTimeFormat(language, {
      timeZone: COMPANY_TIME_ZONE,
      day: "numeric",
      month: "short",
    }),
    second: new Intl.DateTimeFormat(language, {
      timeZone: COMPANY_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    weekday: new Intl.DateTimeFormat(language, {
      timeZone: "UTC",
      weekday: "long",
    }),
  };

  formatterCache.set(locale, formatters);
  return formatters;
}

/** Formats an instant as the company's local date and time parts. */
const companyDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Returns the calendar day in the company's time zone as `YYYY-MM-DD`. */
export function companyDay(instant: Date): string {
  return companyDayFormatter.format(instant);
}

const companyPartFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Returns the company's offset from UTC at a given instant. */
function companyOffsetMs(instant: Date): number {
  const parts = companyPartFormatter.formatToParts(instant);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const localUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour") % 24,
    value("minute"),
    value("second"),
  );

  return localUtc - instant.getTime();
}

/** Returns the instant at which a company calendar day begins. */
export function companyDayStart(day: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00.000Z`);
  const offset = companyOffsetMs(utcMidnight);
  const initial = new Date(utcMidnight.getTime() - offset);

  // Recalculate once because the offset may change at a daylight-saving boundary.
  const correctedOffset = companyOffsetMs(initial);
  return correctedOffset === offset
    ? initial
    : new Date(utcMidnight.getTime() - correctedOffset);
}

/** Returns the start of the company day after the supplied calendar day. */
export function nextCompanyDayStart(day: string): Date {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return companyDayStart(next.toISOString().slice(0, 10));
}

/** Converts a `YYYY-MM-DD` calendar value to a UTC date-only value. */
export function toDateValue(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Formats a date-only value. Date-only values are always formatted in UTC. */
export function formatDay(day: Date, locale: Locale = DEFAULT_LOCALE): string {
  return getFormatters(locale).day.format(day);
}

/** Formats a date-only value with a long weekday and month name. */
export function formatDayLong(day: Date, locale: Locale = DEFAULT_LOCALE): string {
  return getFormatters(locale).dayLong.format(day);
}

/** Formats a date-only value for compact lists. */
export function formatDayShort(day: Date, locale: Locale = DEFAULT_LOCALE): string {
  return getFormatters(locale).dayShort.format(day);
}

/** Formats a timestamp using the company's local time zone. */
export function formatInstant(instant: Date, locale: Locale = DEFAULT_LOCALE): string {
  const formatters = getFormatters(locale);
  return `${formatters.instantDate.format(instant)} ${formatters.time.format(instant)}`;
}

/** Formats the local time portion of a timestamp. */
export function formatTime(instant: Date, locale: Locale = DEFAULT_LOCALE): string {
  return getFormatters(locale).time.format(instant);
}

export interface RelativeDayLabels {
  today: string;
  yesterday: string;
}

function defaultRelativeDayLabels(locale: Locale): RelativeDayLabels {
  const t = createTranslator(locale);
  return {
    today: t("common.today"),
    yesterday: t("common.yesterday"),
  };
}

/** Formats a date as today, yesterday, or a localized date. */
export function formatRelativeDay(
  dayValue: Date,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
  labels?: RelativeDayLabels,
): string {
  const resolvedLabels = labels ?? defaultRelativeDayLabels(locale);
  const day = dayValue.toISOString().slice(0, 10);
  const today = companyDay(now);

  if (day === today) return resolvedLabels.today;

  const yesterday = companyDay(new Date(toDateValue(today).getTime() - 86_400_000));
  if (day === yesterday) return resolvedLabels.yesterday;

  return formatDay(toDateValue(day), locale);
}

/** Formats a timestamp for compact lists. */
export function formatInstantShort(
  instant: Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const formatters = getFormatters(locale);
  return `${formatters.instantShortDate.format(instant)} ${formatters.time.format(instant)}`;
}

/** Formats a timestamp with seconds for audit records. */
export function formatInstantPrecise(
  instant: Date,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const formatters = getFormatters(locale);
  return `${formatters.instantDate.format(instant)} ${formatters.second.format(instant)}`;
}

/** Returns the company-local hour from 0 through 23. */
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: COMPANY_TIME_ZONE,
  hour: "2-digit",
  hour12: false,
});

export function companyHour(instant: Date): number {
  return Number(hourFormatter.format(instant));
}

/** Formats the weekday for a date-only value. */
export function formatWeekday(day: Date, locale: Locale = DEFAULT_LOCALE): string {
  return getFormatters(locale).weekday.format(day);
}

/** Returns the number of minutes elapsed since midnight in the company zone. */
export function companyMinuteOfDay(instant: Date): number {
  const [hour, minute] = getFormatters("en").time.format(instant).split(":");
  return Number(hour) * 60 + Number(minute);
}
