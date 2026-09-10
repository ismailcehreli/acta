import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listTargetDepartments } from "@/server/activities/target-options";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §5.3: seçenek listesi sistemdeki tüm aktif departmanlardır; kişinin kendi
// birimi ve alt birimleri kolaylık olsun diye üstte gelir.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("muhatap departman listesi", () => {
  it("tüm aktif departmanları içerir, akranlar dahil", async () => {
    const root = await createOrgUnit({ name: "Şirket" });
    const benim = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
    await createOrgUnit({ name: "Planlama", parentId: root.id });

    const options = await listTargetDepartments(testDb, benim.id);

    expect(options.map((o) => o.name).sort()).toEqual([
      "Kalıphane",
      "Planlama",
      "Şirket",
    ]);
  });

  it("kendi birimi ve alt birimleri listenin başında gelir", async () => {
    const root = await createOrgUnit({ name: "Şirket" });
    const akran = await createOrgUnit({ name: "Planlama", parentId: root.id });
    const benim = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
    await createOrgUnit({ name: "Kalıp Bakım", parentId: benim.id });

    const options = await listTargetDepartments(testDb, benim.id);

    expect(options.slice(0, 2).map((o) => o.name).sort()).toEqual([
      "Kalıp Bakım",
      "Kalıphane",
    ]);
    expect(options.slice(0, 2).every((o) => o.own)).toBe(true);
    expect(options.find((o) => o.id === akran.id)?.own).toBe(false);
  });

  it("pasif departman seçenek olarak sunulmaz", async () => {
    const root = await createOrgUnit({ name: "Şirket" });
    const benim = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
    const pasif = await createOrgUnit({ name: "Kapanan", parentId: root.id });
    await testDb.orgUnit.update({
      where: { id: pasif.id },
      data: { isActive: false },
    });

    const options = await listTargetDepartments(testDb, benim.id);

    expect(options.map((o) => o.id)).not.toContain(pasif.id);
  });
});
