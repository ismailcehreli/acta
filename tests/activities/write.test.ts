import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity } from "@/server/activities/write";
import { SETTING_KEYS } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §5: faaliyet girişi, düzeltme ve revizyon. Zaman her testte sahte: gerçek
// saate bağlı test, gece yarısı kırılan testtir.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const TODAY = "2026-08-17";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const department = await createOrgUnit({
    name: "Kalıphane",
    type: "Departman",
    parentId: root.id,
  });
  const other = await createOrgUnit({
    name: "Planlama",
    type: "Departman",
    parentId: root.id,
  });
  const user = await createUser(department.id);

  return {
    root,
    department,
    other,
    author: {
      id: user.id,
      orgUnitId: department.id,
      requiresApproval: false,
    },
  };
}

function input(overrides: Partial<Parameters<typeof createActivity>[2]> = {}) {
  return {
    activityDate: TODAY,
    title: "Kalıp bakımı yapıldı",
    description: "Çatlak tespit edildi, onarım planlandı.",
    targetDepartmentIds: [] as string[],
    ...overrides,
  };
}

describe("faaliyet girişi", () => {
  it("onaya tabi olmayan kademede kayıt doğrudan onaylı doğar (§5.4)", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("APPROVED");
  });

  it("onaya tabi kademede kayıt onay bekleyerek doğar (§5.4)", async () => {
    // Onay akışı ürün sahibi kararıyla Sürüm 1'e alındı (19.08.2026); bu test
    // eskiden girişin **reddedildiğini** doğruluyordu. Artık kayıt üretiliyor
    // ve müdürün önüne düşüyor.
    const { author, department, root } = await setup();
    const mudur = await createUser(root.id, {
      fullName: "Genel Müdür",
      isUnitManager: true,
    });

    const result = await createActivity(
      testDb,
      { ...author, requiresApproval: true },
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("PENDING_APPROVAL");
    expect(result.activity.approverId).toBe(mudur.id);
  });

  it("birim yöneticisinin kaydı onaya tabi birimde de doğrudan onaylı doğar (§4.3)", async () => {
    // §4.3: "müdür ve üstü onaya tabi değildir". Bayrak birim düğümünde
    // durduğu için departmanın onay bayrağı müdürü de kapsıyordu ve müdürün
    // kendi kaydı bir üst kademenin kuyruğuna düşüyordu — süzgeç kendi kendini
    // süzemez. Yöneticinin kaydı doğrudan onaylı doğar ve yukarı akar (§7.4).
    const { department, root } = await setup();
    await createUser(root.id, { fullName: "Genel Müdür", isUnitManager: true });
    const mudur = await createUser(department.id, {
      fullName: "Kalıphane Müdürü",
      isUnitManager: true,
    });

    const result = await createActivity(
      testDb,
      { id: mudur.id, orgUnitId: department.id, requiresApproval: true },
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activity.approvalStatus).toBe("APPROVED");
    expect(result.activity.approverId).toBeNull();

    // Onay turu da açılmaz: açık tur "iş birinin önünde bekliyor" demektir.
    const turlar = await testDb.approvalRound.count({
      where: { activityId: result.activity.id },
    });
    expect(turlar).toBe(0);

    const uygunlar = await testDb.activityApprover.count({
      where: { activityId: result.activity.id },
    });
    expect(uygunlar).toBe(0);
  });

  it("yazarın birimi yazım anında dondurulur (§4.6)", async () => {
    const { author, department, root } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Kişi sonradan başka birime geçse de faaliyet yazıldığı birimle kalır.
    await testDb.user.update({
      where: { id: author.id },
      data: { orgUnitId: root.id },
    });

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: result.activity.id },
    });
    expect(stored.authorOrgUnitId).toBe(department.id);
  });

  it("ilk kayıt bir revizyon üretir", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [department.id] }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const revisions = await testDb.activityRevision.findMany({
      where: { activityId: result.activity.id },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revisionNo).toBe(1);
    expect(revisions[0].targetOrgUnitIds).toEqual([department.id]);
  });
});

describe("muhatap departman kuralları (§5.3)", () => {
  it("beş departman seçilebilir", async () => {
    const { author, root } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const unit = await createOrgUnit({ parentId: root.id });
      ids.push(unit.id);
    }

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: ids }),
      NOW,
    );

    expect(result.ok).toBe(true);
    const count = await testDb.activityTargetDept.count();
    expect(count).toBe(5);
  });

  it("altıncı departman veritabanınca reddedilir", async () => {
    const { author, root } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const unit = await createOrgUnit({ parentId: root.id });
      ids.push(unit.id);
    }

    // Zod da altıncıyı reddeder; burada veritabanı kısıtının da tuttuğunu
    // görüyoruz — şema doğrulaması atlansa bile sınır aşılamaz.
    await expect(
      createActivity(testDb, author, input({ targetDepartmentIds: ids }), NOW),
    ).rejects.toThrow(/ACTIVITY_TARGET_LIMIT/);
  });

  it("akranın departmanı da muhatap seçilebilir", async () => {
    const { author, other } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [other.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("pasif departman muhatap seçilemez", async () => {
    const { author, root } = await setup();
    const passive = await createOrgUnit({ parentId: root.id });
    await testDb.orgUnit.update({
      where: { id: passive.id },
      data: { isActive: false },
    });

    const result = await createActivity(
      testDb,
      author,
      input({ targetDepartmentIds: [passive.id] }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("inactive_department");
  });

  it("olmayan departman reddedilir", async () => {
    const { author } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({
        targetDepartmentIds: ["00000000-0000-0000-0000-000000000000"],
      }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unknown_department");
  });
});

describe("geçmişe dönük giriş sınırı (§5.6)", () => {
  it("dünkü faaliyet girilebilir (varsayılan 1 gün)", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-16", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it("iki gün öncesi reddedilir", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-15", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("date_too_old");
  });

  it("ileri tarih reddedilir", async () => {
    const { author, department } = await setup();

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-18", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("future_date");
  });

  it("sınır sistem ayarından okunur, koda gömülü değildir", async () => {
    const { author, department } = await setup();

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "7",
        description: "Geçmişe dönük giriş penceresi (gün)",
      },
    });

    const result = await createActivity(
      testDb,
      author,
      input({ activityDate: "2026-08-12", targetDepartmentIds: [department.id] }),
      NOW,
    );

    expect(result.ok).toBe(true);
  });
});
