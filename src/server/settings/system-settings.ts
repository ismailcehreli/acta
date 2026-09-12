import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import {
  findSetting,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SETTING_PAIR_RULES,
  SETTING_SUM_RULES,
  validateSettingValue,
} from "./registry";
import { parseDomainList } from "./email-domains";

export { SETTING_KEYS };
export type SettingsDb = Pick<PrismaClient, "systemSetting">;

export interface ActivityTextLimits {
  titleMin: number;
  titleMax: number;
  descriptionMin: number;
  descriptionMax: number;
}

export async function readAllSettings(
  db: SettingsDb,
): Promise<Record<string, string>> {
  const rows = await db.systemSetting.findMany();
  const persisted = new Map(rows.map((row) => [row.key, row.value]));

  const result: Record<string, string> = {};
  for (const definition of SETTING_DEFINITIONS) {
    result[definition.key] = persisted.get(definition.key) ?? definition.defaultValue;
  }

  return result;
}

async function readRaw(db: SettingsDb, key: string): Promise<string> {
  const definition = findSetting(key);
  if (!definition) {
    // Missing key in registry is a programmer error; do not silently fall back.
    throw new Error(`Undefined setting key: ${key}`);
  }

  const row = await db.systemSetting.findUnique({ where: { key } });
  if (!row) return definition.defaultValue;

  // Corrupted persisted record does not halt system, but logs warning and falls back to default.
  const validation = validateSettingValue(definition, row.value);
  if (!validation.ok) {
    console.error(
      `[settings] "${key}" invalid ("${row.value}"): ${validation.message} ` +
        `Default ${definition.defaultValue} used instead.`,
    );
    return definition.defaultValue;
  }

  return validation.value;
}

/** Reads a single setting, returning registry default if not persisted. */
export async function readSettingValue(
  db: SettingsDb,
  key: string,
): Promise<string> {
  return readRaw(db, key);
}

export async function readNumericSetting(
  db: SettingsDb,
  key: string,
): Promise<number> {
  return Number(await readRaw(db, key));
}

/**
 * Allowed email domains. If corrupted, restriction is treated as disabled.
 */
export async function readAllowedEmailDomains(
  db: SettingsDb,
): Promise<string[]> {
  const raw = await readRaw(db, SETTING_KEYS.allowedEmailDomains);
  const list = parseDomainList(raw);

  if (!list.ok) {
    console.error(`[settings] allowed email domains could not be read: ${list.message}`);
    return [];
  }

  return list.domains;
}

export async function readBooleanSetting(
  db: SettingsDb,
  key: string,
): Promise<boolean> {
  return (await readRaw(db, key)) === "true";
}

export type SaveSettingsResult =
  | { ok: true; changed: string[] }
  | {
      ok: false;
      error: "undefined_setting" | "invalid_value" | "pair_invalid" | "sum_invalid";
      message: string;
      messageKey?: string;
      messageValues?: Record<string, string | number>;
    };

/**
 * Validates and saves given settings atomically. All or nothing.
 */
export async function saveSettings(
  db: SettingsDb &
    Pick<PrismaClient, "$transaction" | "$executeRaw" | "auditLog">,
  values: Record<string, string>,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<SaveSettingsResult> {
  const toWrite: { key: string; value: string; description: string }[] = [];

  for (const [key, raw] of Object.entries(values)) {
    const definition = findSetting(key);
    if (!definition) {
      return {
        ok: false,
        error: "undefined_setting",
        message: `Undefined setting: ${key}`,
        messageKey: "errors.settings.undefinedSetting",
        messageValues: { key },
      };
    }

    const validation = validateSettingValue(definition, raw);
    if (!validation.ok) {
      return {
        ok: false,
        error: "invalid_value",
        message: validation.message,
        messageKey: validation.messageKey,
        messageValues: validation.messageValues,
      };
    }

    toWrite.push({
      key,
      value: validation.value,
      description: definition.label,
    });
  }

  // Cross-validation is protected against race conditions using advisory lock.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acta:system_settings'))`;

    const current = await readAllSettings(tx);

    const nextValue = (key: string): number | null => {
      const pending = toWrite.find((item) => item.key === key);
      const raw = pending?.value ?? current[key] ?? findSetting(key)?.defaultValue;
      if (raw === undefined) return null;

      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    };

    for (const rule of SETTING_PAIR_RULES) {
      const touched = toWrite.some(
        (item) => item.key === rule.min || item.key === rule.max,
      );
      if (!touched) continue;

      const min = nextValue(rule.min);
      const max = nextValue(rule.max);
      if (min === null || max === null) continue;

      if (min > max) {
        return {
          ok: false,
          error: "pair_invalid",
          message: rule.message,
          messageKey: rule.messageKey,
        };
      }
    }

    // Sum rules: base score total must sum to 100 for each profile.
    for (const rule of SETTING_SUM_RULES) {
      const touched = toWrite.some((item) => rule.keys.includes(item.key));
      if (!touched) continue;

      let sum = 0;
      let missing = false;

      for (const key of rule.keys) {
        const val = nextValue(key);
        if (val === null) {
          missing = true;
          break;
        }
        sum += val;
      }

      if (missing) continue;
      if (sum !== rule.total) {
        return {
          ok: false,
          error: "sum_invalid",
          message: `${rule.message} Currently ${sum}.`,
          messageKey: rule.messageKey,
          messageValues: { sum },
        };
      }
    }

    const changedKeys = toWrite
      .filter((item) => current[item.key] !== item.value)
      .map((item) => item.key);

    for (const item of toWrite) {
      await tx.systemSetting.upsert({
        where: { key: item.key },
        update: { value: item.value, description: item.description },
        create: { key: item.key, value: item.value, description: item.description },
      });
    }

    if (changedKeys.length > 0) {
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.setting,
        objectId: "system",
        action: AUDIT_ACTIONS.settingsChanged,
        detail: {
          changed: changedKeys.map((key) => ({
            key,
            before: current[key],
            after: toWrite.find((item) => item.key === key)?.value,
          })),
        },
        now,
      });
    }

    return { ok: true, changed: changedKeys };
  });
}

/**
 * Activity text length boundaries (Task 11.6).
 */
export async function readActivityTextLimits(
  db: SettingsDb,
): Promise<ActivityTextLimits> {
  const [titleMin, titleMax, descriptionMin, descriptionMax] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.activityTitleMinChars),
    readNumericSetting(db, SETTING_KEYS.activityTitleMaxChars),
    readNumericSetting(db, SETTING_KEYS.activityDescriptionMinChars),
    readNumericSetting(db, SETTING_KEYS.activityDescriptionMaxChars),
  ]);

  return { titleMin, titleMax, descriptionMin, descriptionMax };
}
