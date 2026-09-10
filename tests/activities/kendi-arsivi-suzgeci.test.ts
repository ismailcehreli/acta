import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countOwnActivities, listOwnActivities } from "@/server/activities/read";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// "Faaliyetlerim" ekranının süzgeçleri (Görev 11.3).
//
// Ekran bugün süzgeçsiz: kişi kendi arşivinde bir kaydı ancak sayfa sayfa
// gezerek buluyor. Dört daraltma geliyor — dönem, onay durumu, açık soru ve
// muhatap departman.
//
// **Süzgeç kapsamı genişletemez.** Sorgu her zaman görünürlük filtresiyle ve
// `authorId` koşuluyla başlar; buradaki alanlar yalnız daraltır (§8.4).

const NOW = new Date("2026-08-19T09:00:00.000Z"); // Çarşamba

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisi() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });

  const worker = await createUser(moldShop.id, { fullName: "Kalıphane Çalışanı" });
  const baskasi = await createUser(moldShop.id, { fullName: "Başka Kişi" });

  return { root, moldShop, planning, worker, baskasi };
}

const gun = (g: string) => new Date(`${g}T00:00:00.000Z`);

describe("dönem süzgeci", () => {
  it("bu hafta seçilince önceki haftanın kaydını getirmez", async () => {
    const { worker } = await kisi();

    await createActivity(worker, { title: "Bu hafta", activityDate: gun("2026-08-18") });
    await createActivity(worker, { title: "Geçen hafta", activityDate: gun("2026-08-14") });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const sonuc = await listOwnActivities(testDb, viewer, {
      period: "week",
      now: NOW,
    });

    expect(sonuc.map((a) => a.title)).toEqual(["Bu hafta"]);
  });

  it("tümü seçilince dönem sınırı koymaz", async () => {
    const { worker } = await kisi();

    await createActivity(worker, { title: "Bu hafta", activityDate: gun("2026-08-18") });
    await createActivity(worker, { title: "Geçen hafta", activityDate: gun("2026-08-14") });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const sonuc = await listOwnActivities(testDb, viewer, { period: "all", now: NOW });

    expect(sonuc).toHaveLength(2);
  });
});

describe("durum süzgeci", () => {
  it("yalnız seçilen onay durumundaki kayıtları getirir", async () => {
    const { worker } = await kisi();

    await createActivity(worker, { title: "Onaylı", approvalStatus: "APPROVED" });
    await createActivity(worker, { title: "İptal", approvalStatus: "CANCELLED" });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const sonuc = await listOwnActivities(testDb, viewer, {
      period: "all",
      now: NOW,
      status: "CANCELLED",
    });

    expect(sonuc.map((a) => a.title)).toEqual(["İptal"]);
  });
});

describe("açık soru süzgeci", () => {
  it("yalnız açık sorusu olan kendi kaydını getirir", async () => {
    const { worker, baskasi } = await kisi();
    const sorulu = await createActivity(worker, { title: "Sorusu olan" });
    const sorusuz = await createActivity(worker, { title: "Sorusuz" });

    await testDb.conversation.create({
      data: {
        activityId: sorulu.id,
        askerId: baskasi.id,
        responsibleId: worker.id,
        status: "OPEN",
      },
    });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const filters = { period: "all" as const, now: NOW, openQuestions: true };
    const [activities, count] = await Promise.all([
      listOwnActivities(testDb, viewer, filters),
      countOwnActivities(testDb, viewer, filters),
    ]);

    expect(activities.map((activity) => activity.id)).toEqual([sorulu.id]);
    expect(activities.map((activity) => activity.id)).not.toContain(sorusuz.id);
    expect(count).toBe(activities.length);
  });

  it("kullanıcının kendi sorduğu soru kendi arşivinde cevap bekleyen sayılmaz", async () => {
    const { worker, baskasi } = await kisi();
    const kendiSorusu = await createActivity(worker, { title: "Kendi sorum" });

    await testDb.conversation.create({
      data: {
        activityId: kendiSorusu.id,
        askerId: worker.id,
        responsibleId: baskasi.id,
        status: "OPEN",
      },
    });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const filters = { period: "all" as const, now: NOW, openQuestions: true };
    const [activities, count] = await Promise.all([
      listOwnActivities(testDb, viewer, filters),
      countOwnActivities(testDb, viewer, filters),
    ]);

    expect(activities).toHaveLength(0);
    expect(count).toBe(0);
  });
});

describe("muhatap departman süzgeci", () => {
  it("yalnız o departmanın muhatap gösterildiği kayıtları getirir", async () => {
    const { moldShop, planning, worker } = await kisi();

    const planlamaya = await createActivity(worker, { title: "Planlamaya" });
    const kaliphaneye = await createActivity(worker, { title: "Kalıphaneye" });
    await testDb.activityTargetDept.createMany({
      data: [
        { activityId: planlamaya.id, orgUnitId: planning.id },
        { activityId: kaliphaneye.id, orgUnitId: moldShop.id },
      ],
    });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const sonuc = await listOwnActivities(testDb, viewer, {
      period: "all",
      now: NOW,
      targetOrgUnitId: planning.id,
    });

    expect(sonuc.map((a) => a.title)).toEqual(["Planlamaya"]);
  });
});

describe("sayaç ile liste aynı süzgeci kullanır", () => {
  it("sayaç da daraltmayı uygular", async () => {
    const { worker } = await kisi();

    await createActivity(worker, { title: "Onaylı", approvalStatus: "APPROVED" });
    await createActivity(worker, { title: "İptal", approvalStatus: "CANCELLED" });

    const viewer = { id: worker.id, isSystemAdmin: false };

    expect(
      await countOwnActivities(testDb, viewer, {
        period: "all",
        now: NOW,
        status: "CANCELLED",
      }),
    ).toBe(1);
  });
});

describe("süzgeç kapsam açmaz", () => {
  // Hiçbir süzgeç kombinasyonu başkasının kaydını "Faaliyetlerim"e sokamaz.
  it("başkasının kaydını hiçbir süzgeçle getirmez", async () => {
    const { worker, baskasi } = await kisi();

    await createActivity(baskasi, { title: "Başkasının kaydı" });
    await createActivity(worker, { title: "Kendi kaydım" });

    const viewer = { id: worker.id, isSystemAdmin: false };
    const sonuc = await listOwnActivities(testDb, viewer, { period: "all", now: NOW });

    expect(sonuc.map((a) => a.title)).toEqual(["Kendi kaydım"]);
  });
});
