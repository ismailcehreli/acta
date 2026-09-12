import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  SETTING_KEYS,
  readNumericSetting,
  saveSettings,
} from "@/server/settings/system-settings";

import { resetDatabase, testDb } from "../helpers/test-db";

// Cross-validation between settings (Task 11.6).
//
// Text length constraints are interdependent: if minimum exceeds maximum,
// no input is accepted. The registry must enforce this relationship.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("title length pair", () => {
  it("minimum cannot exceed maximum", async () => {
    // 80 in [1,100] and 50 in [10,150]: both valid independently, but 80 > 50.
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "80",
      [SETTING_KEYS.activityTitleMaxChars]: "50",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/cannot exceed the maximum|minimum/i);
  });

  it("valid pair is saved", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "10",
      [SETTING_KEYS.activityTitleMaxChars]: "120",
    });

    expect(result.ok).toBe(true);
    expect(await readNumericSetting(testDb, SETTING_KEYS.activityTitleMinChars)).toBe(10);
  });

  it("compared with persisted value even if single field sent", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMinChars]: "80",
      [SETTING_KEYS.activityTitleMaxChars]: "120",
    });

    // 50 in [10,150] — valid on its own, but stored minimum is 80.
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMaxChars]: "50",
    });

    expect(result.ok).toBe(false);
  });
});

describe("description length pair", () => {
  it("minimum cannot exceed maximum", async () => {
    // 900 in [1,1000] and 300 in [100,10000]: both valid independently, but 900 > 300.
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMinChars]: "900",
      [SETTING_KEYS.activityDescriptionMaxChars]: "300",
    });

    expect(result.ok).toBe(false);
  });

  it("equal values are accepted", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMinChars]: "100",
      [SETTING_KEYS.activityDescriptionMaxChars]: "100",
    });

    expect(result.ok).toBe(true);
  });
});

describe("database ceiling cannot be exceeded", () => {
  it("title upper limit cannot exceed column width", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityTitleMaxChars]: "500",
    });

    expect(result.ok).toBe(false);
  });

  it("description upper limit cannot exceed column width", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.activityDescriptionMaxChars]: "20000",
    });

    expect(result.ok).toBe(false);
  });
});
