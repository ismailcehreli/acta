import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { oturum } = vi.hoisted(() => ({
  oturum: {
    kisi: null as { id: string; isSystemAdmin: boolean } | null,
  },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => oturum.kisi,
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
  oturum.kisi = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function eskiKurulum() {
  const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
  const admin = await createUser(kok.id, {
    email: "admin@sirket.test",
    isSystemAdmin: true,
  });
  const sonuc = await installDemoData(testDb);
  if (!sonuc.ok) throw new Error("kurulum başarısız");
  await testDb.demoObject.deleteMany();
  return admin;
}

function form(adaylar: Awaited<ReturnType<typeof listLegacyDemoOriginCandidates>>) {
  const veri = new FormData();
  for (const aday of adaylar) {
    veri.append("orgUnitId", aday.id);
    veri.set(`origin:${aday.id}`, "CREATED_BY_INSTALLER");
  }
  return veri;
}

describe("eski örnek birim kökeni sunucu eylemi", () => {
  it("sistem yöneticisinin bütün açık kararlarını kaydeder", async () => {
    const admin = await eskiKurulum();
    oturum.kisi = { id: admin.id, isSystemAdmin: true };
    const adaylar = await listLegacyDemoOriginCandidates(testDb);

    const sonuc = await classifyLegacyDemoOriginsAction(
      { error: null, success: null },
      form(adaylar),
    );

    expect(sonuc.error).toBeNull();
    expect(
      await testDb.demoObject.count({
        where: { objectType: DEMO_OBJECT_ORG_UNIT },
      }),
    ).toBe(adaylar.length);
  });

  it("sistem yöneticisi olmayan kullanıcının elle kurduğu isteği reddeder", async () => {
    const admin = await eskiKurulum();
    oturum.kisi = { id: admin.id, isSystemAdmin: false };
    const adaylar = await listLegacyDemoOriginCandidates(testDb);

    await expect(
      classifyLegacyDemoOriginsAction(
        { error: null, success: null },
        form(adaylar),
      ),
    ).rejects.toThrow("sistem yöneticisi");
    expect(await testDb.demoObject.count()).toBe(0);
  });
});

