import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    user: null as { id: string; isSystemAdmin: boolean } | null,
  },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => sessionState.user,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { classifyLegacyDemoOriginsAction } = await import(
  "@/app/admin/settings/actions"
);

import { installDemoData } from "@/server/demo/data";
import {
  DEMO_OBJECT_ORG_UNIT,
  listLegacyDemoOriginCandidates,
} from "@/server/demo/origin";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
  sessionState.user = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupLegacyInstallation() {
  const root = await createOrgUnit({ name: "Acta HQ", type: "Root" });
  const admin = await createUser(root.id, {
    email: "admin@company.test",
    isSystemAdmin: true,
  });
  const result = await installDemoData(testDb);
  if (!result.ok) throw new Error("Installation failed");
  await testDb.demoObject.deleteMany();
  return admin;
}

function buildOriginFormData(candidates: Awaited<ReturnType<typeof listLegacyDemoOriginCandidates>>) {
  const formData = new FormData();
  for (const candidate of candidates) {
    formData.append("orgUnitId", candidate.id);
    formData.set(`origin:${candidate.id}`, "CREATED_BY_INSTALLER");
  }
  return formData;
}

describe("legacy demo unit origin server action", () => {
  it("records all explicit decisions made by system admin", async () => {
    const admin = await setupLegacyInstallation();
    sessionState.user = { id: admin.id, isSystemAdmin: true };
    const candidates = await listLegacyDemoOriginCandidates(testDb);

    const result = await classifyLegacyDemoOriginsAction(
      { error: null, success: null },
      buildOriginFormData(candidates),
    );

    expect(result.error).toBeNull();
    expect(
      await testDb.demoObject.count({
        where: { objectType: DEMO_OBJECT_ORG_UNIT },
      }),
    ).toBe(candidates.length);
  });

  it("rejects forged request by non-admin user", async () => {
    const admin = await setupLegacyInstallation();
    sessionState.user = { id: admin.id, isSystemAdmin: false };
    const candidates = await listLegacyDemoOriginCandidates(testDb);

    await expect(
      classifyLegacyDemoOriginsAction(
        { error: null, success: null },
        buildOriginFormData(candidates),
      ),
    ).rejects.toThrow();
    expect(await testDb.demoObject.count()).toBe(0);
  });
});
