import { z } from "zod";
import { formatInstant } from "@/shared/format/date-time";
import {
  createTranslator,
  DEFAULT_LOCALE,
  type Locale,
} from "@/shared/i18n";

// Unfinished activity text stored locally on the device. It is distinct from
// the database DRAFT status and never reaches the server until submitted.

export const activityDraftSchema = z.object({
  activityDate: z.string().max(20),
  title: z.string().max(150),
  description: z.string().max(10_000),
  targetDepartmentIds: z.array(z.string().uuid()).max(20),
  /** Used to tell the user when the local copy was written. */
  savedAt: z.string().datetime(),
});

export type ActivityDraft = z.infer<typeof activityDraftSchema>;

export interface DraftFields {
  activityDate: string;
  title: string;
  description: string;
  targetDepartmentIds: string[];
}

/**
 * Validates data read from local storage before using it. A malformed local
 * copy is ignored because it is optional convenience data, not a business rule.
 */
export function parseDraft(raw: string | null): ActivityDraft | null {
  if (!raw) return null;

  try {
    const parsed = activityDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Whether the draft contains text worth saving. */
export function hasContent(fields: DraftFields): boolean {
  return fields.title.trim() !== "" || fields.description.trim() !== "";
}

/**
 * Whether restoring the draft should be offered.
 *
 * Offering it when the form already contains the same text would be confusing.
 */
export function differsFromCurrent(
  draft: DraftFields,
  current: DraftFields,
): boolean {
  if (draft.title.trim() !== current.title.trim()) return true;
  if (draft.description.trim() !== current.description.trim()) return true;
  if (draft.activityDate !== current.activityDate) return true;

  const a = [...draft.targetDepartmentIds].sort();
  const b = [...current.targetDepartmentIds].sort();
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
}

export interface SavedAtLabels {
  justNow: string;
  minutesAgo: (count: number) => string;
  hoursAgo: (count: number) => string;
}

function defaultSavedAtLabels(locale: Locale): SavedAtLabels {
  const t = createTranslator(locale);
  return {
    justNow: t("notifications.relativeTime.justNow"),
    minutesAgo: (count) => t("notifications.relativeTime.minutes", { count }),
    hoursAgo: (count) => t("notifications.relativeTime.hours", { count }),
  };
}

/** Formats the time at which a local draft was saved. */
export function savedAtLabel(
  savedAt: string,
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
  labels?: SavedAtLabels,
): string {
  const resolvedLabels = labels ?? defaultSavedAtLabels(locale);
  const diff = now.getTime() - new Date(savedAt).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return resolvedLabels.justNow;
  if (minutes < 60) return resolvedLabels.minutesAgo(minutes);

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return resolvedLabels.hoursAgo(hours);

  return formatInstant(new Date(savedAt), locale);
}
