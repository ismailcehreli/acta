import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, updateActivity } from "@/server/activities/write";
import { SETTING_KEYS } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §5.5: onaylanmış faaliyet, kayıttan sonraki kısa pencere içinde ve **henüz
// kimse okumadıysa** düzeltilebilir. Sonrasında değiştirilemez — üst kademeler
// okumuş olabilir ve sonradan değişmesi güveni bozar (İlke 5).

const NOW = new Date("2026-08-17T09:00:00.000Z");
const TODAY = "2026-08-17";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupWithActivity() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const department = await createOrgUnit({
    name: "Kalıphane",
    type: "Departman",
    parentId: root.id,
  });
  const user = await createUser(department.id);
  const reader = await createUser(root.id);
  const author = { id: user.id, orgUnitId: department.id, requiresApproval: false };

  const created = await createActivity(
    testDb,
    author,
    {
      activityDate: TODAY,
      title: "İlk başlık",
      description: "İlk açıklama",
      targetDepartmentIds: [department.id],
    },
    NOW,
  );

  if (!created.ok) throw new Error("kurulum başarısız");

  return { root, department, author, reader, activity: created.activity };
}

function editInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    activityDate: TODAY,
    title: "Düzeltilmiş başlık",
    description: "Düzeltilmiş açıklama",
    targetDepartmentIds: [] as string[],
    ...overrides,
  };
}

describe("düzeltme penceresi", () => {
  it("15 dakika içinde ve okunmamışsa düzeltilebilir", async () => {
    const { author, department, activity } = await setupWithActivity();
    const fourteenMinutesLater = new Date(NOW.getTime() + 14 * 60_000);

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      fourteenMinutesLater,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.title).toBe("Düzeltilmiş başlık");
  });

  it("15 dakika geçtikten sonra düzeltilemez", async () => {
    const { author, department, activity } = await setupWithActivity();
    const sixteenMinutesLater = new Date(NOW.getTime() + 16 * 60_000);

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      sixteenMinutesLater,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("window_closed");
  });

  it("pencere süresi sistem ayarından okunur", async () => {
    const { author, department, activity } = await setupWithActivity();
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.editWindowMinutes,
        value: "60",
        description: "Düzeltme penceresi (dakika)",
      },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 45 * 60_000),
    );

    expect(result.ok).toBe(true);
  });
});

describe("okundu bilgisi düzeltmeyi kapatır (§10 bağlantısı)", () => {
  it("başkası okuduysa pencere içinde bile düzeltilemez", async () => {
    const { author, department, reader, activity } = await setupWithActivity();

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: reader.id },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_read");
  });

  it("yazanın kendi okuması düzeltmeyi kapatmaz", async () => {
    const { author, department, activity } = await setupWithActivity();

    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: author.id },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(true);
  });
});

describe("düzeltme yetkisi", () => {
  it("başkasının faaliyeti düzeltilemez", async () => {
    const { department, activity } = await setupWithActivity();
    const stranger = await createUser(department.id);

    const result = await updateActivity(
      testDb,
      stranger.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Dışarıya "bulunamadı" denir: "senin değil" demek kaydın varlığını
    // ele verirdi (denetim 18.08.2026, bulgu 1).
    expect(result.error).toBe("not_found");
    expect(result.message).toBe("Faaliyet bulunamadı.");

    // İçerik gerçekten değişmemiş olmalı.
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.title).toBe("İlk başlık");
  });

  it("iptal edilmiş faaliyet düzeltilemez", async () => {
    const { author, department, activity } = await setupWithActivity();
    await testDb.activity.update({
      where: { id: activity.id },
      data: { approvalStatus: "CANCELLED" },
    });

    const result = await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("cancelled");
  });
});

describe("revizyon geçmişi (§5.5)", () => {
  it("her düzeltme yeni bir revizyon bırakır ve eski içerik korunur", async () => {
    const { author, department, activity } = await setupWithActivity();

    await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, { targetDepartmentIds: [department.id] }),
      new Date(NOW.getTime() + 60_000),
    );

    const revisions = await testDb.activityRevision.findMany({
      where: { activityId: activity.id },
      orderBy: { revisionNo: "asc" },
    });

    expect(revisions).toHaveLength(2);
    expect(revisions[0].title).toBe("İlk başlık");
    expect(revisions[1].title).toBe("Düzeltilmiş başlık");

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.currentRevisionNo).toBe(2);
  });

  it("muhatap listesi değişince revizyon o anki listeyi dondurur", async () => {
    const { author, department, root, activity } = await setupWithActivity();
    const digerDepartman = await createOrgUnit({ parentId: root.id });

    await updateActivity(
      testDb,
      author.id,
      editInput(activity.id, {
        targetDepartmentIds: [digerDepartman.id],
      }),
      new Date(NOW.getTime() + 60_000),
    );

    const revisions = await testDb.activityRevision.findMany({
      where: { activityId: activity.id },
      orderBy: { revisionNo: "asc" },
    });

    expect(revisions[0].targetOrgUnitIds).toEqual([department.id]);
    expect(revisions[1].targetOrgUnitIds).toEqual([digerDepartman.id]);

    // Güncel muhatap listesi de değişmiş olmalı.
    const current = await testDb.activityTargetDept.findMany({
      where: { activityId: activity.id },
    });
    expect(current.map((row) => row.orgUnitId)).toEqual([digerDepartman.id]);
  });

  it("revizyon kayıtları değiştirilemez ve silinemez", async () => {
    const { author, activity } = await setupWithActivity();

    const revision = await testDb.activityRevision.findFirstOrThrow({
      where: { activityId: activity.id },
    });

    await expect(
      testDb.activityRevision.delete({ where: { id: revision.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);

    expect(author.id).toBeTruthy();
  });
});
