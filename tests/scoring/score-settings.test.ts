import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { readUserScore } from "@/server/scoring/read";
import { readScoreWeights } from "@/server/scoring/weights";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import {
  createActivity,
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Score weights are configurable system settings.
// All 4 weights must sum to 100 in cross-validation across profiles.

const NOW = new Date("2026-08-20T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, { [SETTING_KEYS.scoringEnabled]: "true" });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupCompany() {
  const root = await createOrgUnit({ name: "Company Root", type: "Root" });
  const unit = await createOrgUnit({
    name: "Workshop",
    parentId: root.id,
    requiresApproval: true,
  });

  const manager = await createUser(unit.id, {
    fullName: "Workshop Manager",
    isUnitManager: true,
  });
  const artisan = await createUser(unit.id, { fullName: "Lead Artisan" });

  await createActivity(artisan, {
    activityDate: new Date("2026-08-03T00:00:00.000Z"),
    approvalStatus: "APPROVED",
    approverId: manager.id,
  });
  const reason = await createApprovalReason("REJECTED");
  await createActivity(artisan, {
    activityDate: new Date("2026-08-04T00:00:00.000Z"),
    approvalStatus: "REJECTED",
    approverId: manager.id,
    approvalSubmittedAt: new Date("2026-08-04T08:00:00.000Z"),
    approvalDecidedAt: new Date("2026-08-04T09:00:00.000Z"),
    approvalReasonId: reason.id,
    approvalReasonKind: "REJECTED",
  });

  return { artisan, manager };
}

describe("score weights originate from system settings", () => {
  it("defaults match design specification values", async () => {
    const weights = await readScoreWeights(testDb);

    expect(weights).toEqual({
      regularity: 60,
      acceptance: 30,
      approval: 30,
      followUp: 10,
    });
  });

  it("changing weight setting recalculates user score", async () => {
    const { artisan } = await setupCompany();
    const viewer = { id: artisan.id, isSystemAdmin: false };

    const before = await readUserScore(testDb, viewer, artisan.id, NOW);

    const result = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "30",
      [SETTING_KEYS.scoringWeightAcceptance]: "60",
      [SETTING_KEYS.scoringWeightApproval]: "60",
    });
    expect(result.ok).toBe(true);

    const after = await readUserScore(testDb, viewer, artisan.id, NOW);

    expect(before?.total).not.toBe(after?.total);
    expect(after?.total ?? 0).toBeGreaterThan(before?.total ?? 0);
  });

  it("rejects combination that does not sum to 100 in employee profile", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "70",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("100");
  });

  it("rejects combination that does not sum to 100 in manager profile", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightApproval]: "40",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeDefined();
  });

  it("accepts combination that preserves 100 sum", async () => {
    const result = await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "50",
      [SETTING_KEYS.scoringWeightAcceptance]: "40",
      [SETTING_KEYS.scoringWeightApproval]: "40",
      [SETTING_KEYS.scoringWeightFollowUp]: "10",
    });

    expect(result.ok).toBe(true);
    expect(await readScoreWeights(testDb)).toEqual({
      regularity: 50,
      acceptance: 40,
      approval: 40,
      followUp: 10,
    });
  });

  it("persists no settings when an invalid combination is rejected", async () => {
    await saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightRegularity]: "50",
      [SETTING_KEYS.scoringWeightAcceptance]: "20",
    });

    expect(await readScoreWeights(testDb)).toEqual({
      regularity: 60,
      acceptance: 30,
      approval: 30,
      followUp: 10,
    });
  });
});

function barrierDb(signalReady: () => void, waitPromise: Promise<void>) {
  let firstRead = true;

  const settingProxy = (target: unknown) =>
    new Proxy(target as object, {
      get(targetObj, prop) {
        if (prop !== "findMany") return Reflect.get(targetObj, prop);

        const findMany = Reflect.get(targetObj, prop) as (
          ...args: unknown[]
        ) => Promise<unknown>;

        return async (...args: unknown[]) => {
          const result = await findMany.apply(targetObj, args);
          if (firstRead) {
            firstRead = false;
            signalReady();
            await waitPromise;
          }
          return result;
        };
      },
    });

  const clientProxy = (targetClient: object): object =>
    new Proxy(targetClient, {
      get(targetObj, prop) {
        if (prop === "systemSetting") {
          return settingProxy(Reflect.get(targetObj, prop));
        }

        if (prop === "$transaction") {
          const original = Reflect.get(targetObj, prop) as (
            fn: (tx: unknown) => Promise<unknown>,
          ) => Promise<unknown>;

          return (fn: (tx: unknown) => Promise<unknown>) =>
            original.call(targetObj, (tx: unknown) => fn(clientProxy(tx as object)));
        }

        const value = Reflect.get(targetObj, prop);
        return typeof value === "function" ? value.bind(targetObj) : value;
      },
    });

  return clientProxy(testDb) as unknown as typeof testDb;
}

describe("concurrent setting writes preserve sum invariant", () => {
  it("preserves sum of 100 across profiles even under racing partial saves", async () => {
    let signalReady = () => {};
    let release = () => {};
    const ready = new Promise<void>((resolve) => (signalReady = resolve));
    const waitPromise = new Promise<void>((resolve) => (release = resolve));

    const aPromise = saveSettings(barrierDb(() => signalReady(), waitPromise), {
      [SETTING_KEYS.scoringWeightRegularity]: "40",
      [SETTING_KEYS.scoringWeightAcceptance]: "50",
      [SETTING_KEYS.scoringWeightApproval]: "50",
    });

    await ready;

    const bPromise = saveSettings(testDb, {
      [SETTING_KEYS.scoringWeightFollowUp]: "20",
      [SETTING_KEYS.scoringWeightAcceptance]: "20",
      [SETTING_KEYS.scoringWeightApproval]: "20",
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await Promise.all([aPromise, bPromise]);

    const finalWeights = await readScoreWeights(testDb);

    expect(finalWeights.regularity + finalWeights.acceptance + finalWeights.followUp).toBe(100);
    expect(finalWeights.regularity + finalWeights.approval + finalWeights.followUp).toBe(100);
  });
});
