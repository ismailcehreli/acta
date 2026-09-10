import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countScopeActivities,
  listScopeActivities,
} from "@/server/activities/scope-feed";
import { subordinateUserIds } from "@/server/authz/visibility";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// "Cevap bekleyen faaliyet" sayacının listesi (Görev 17.1).
//
// Ana ekrandaki sayaç ve tıklandığında açılan liste aynı faaliyet kümesini
// kullanır: bir faaliyette iki uygun açık soru olsa bile faaliyet bir kez
// gösterilir. Kullanıcının kendi sorduğu soru bu sayaca ve süzgece girmez;
// iş kuyruğunda "İzlediklerim" olarak kalır.
//
// Süzgecin **kapsam açmaması** ayrıca sınanır: açık soru görünürlük vermez
// (§8.4, sızıntı toleransı sıfır).

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });

  const manager = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const worker = await createUser(moldShop.id, { fullName: "Kalıphane Çalışanı" });
  const yabanci = await createUser(planning.id, { fullName: "Planlama Çalışanı" });

  return { root, moldShop, planning, manager, worker, yabanci };
}

async function soruAc(activityId: string, askerId: string, responsibleId: string) {
  return testDb.conversation.create({
    data: { activityId, askerId, responsibleId, status: "OPEN" },
  });
}

describe("açık soru süzgeci", () => {
  it("yalnız cevap bekleyen faaliyeti olan kayıtları getirir", async () => {
    const { manager, worker, yabanci } = await sirket();

    const sorulu = await createActivity(worker, {
      title: "Sorusu olan kayıt",
    });
    const cevaplanmis = await createActivity(worker, {
      title: "Sorusu kapanmış kayıt",
    });
    await createActivity(worker, { title: "Sorusuz kayıt" });

    await soruAc(sorulu.id, yabanci.id, worker.id);
    await testDb.conversation.create({
      data: {
        activityId: cevaplanmis.id,
        askerId: yabanci.id,
        responsibleId: worker.id,
        status: "CLOSED",
        closedById: manager.id,
        closedAt: NOW,
        closeType: "NORMAL",
      },
    });

    const viewer = { id: manager.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, manager.id);

    const sonuc = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", openQuestions: true },
      NOW,
      { subordinates: asts },
    );

    expect(sonuc.items.map((i) => i.title)).toEqual(["Sorusu olan kayıt"]);
  });

  it("sayaç da aynı süzgeci uygular", async () => {
    const { manager, worker, yabanci } = await sirket();

    const sorulu = await createActivity(worker, { title: "Sorulu" });
    await createActivity(worker, { title: "Sorusuz" });
    await soruAc(sorulu.id, yabanci.id, worker.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, manager.id);

    expect(
      await countScopeActivities(
        testDb,
        viewer,
        { period: "all", openQuestions: true },
        NOW,
        { subordinates: asts },
      ),
    ).toBe(1);
  });

  // Bir faaliyette iki uygun açık soru olabilir; liste kaydı **bir kez** gösterir.
  it("aynı kaydı iki soru için tekrarlamaz", async () => {
    const { manager, worker, yabanci } = await sirket();

    const sorulu = await createActivity(worker, { title: "İki sorulu" });
    await soruAc(sorulu.id, yabanci.id, worker.id);
    await soruAc(sorulu.id, yabanci.id, worker.id);
    // Süzgecin ayıklaması gereken kayıt: olmasaydı test süzgeç yokken de
    // geçerdi ve hiçbir şey kanıtlamazdı.
    await createActivity(worker, { title: "Sorusuz" });

    const viewer = { id: manager.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, manager.id);

    const sonuc = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", openQuestions: true },
      NOW,
      { subordinates: asts },
    );

    expect(sonuc.items).toHaveLength(1);
  });

  // Süzgeç **daraltır, açmaz**: başka birimin kaydı, üzerinde açık soru olsa
  // da kapsam dışındaki kişiye görünmez.
  it("kapsam dışındaki kaydı açık soru yüzünden getirmez", async () => {
    const { manager, worker, yabanci } = await sirket();

    const disardaki = await createActivity(yabanci, {
      title: "Başka birimin kaydı",
    });
    await soruAc(disardaki.id, yabanci.id, yabanci.id);

    const kendi = await createActivity(worker, { title: "Kendi kaydı" });
    await soruAc(kendi.id, yabanci.id, worker.id);
    // Kapsam içinde ama sorusuz: süzgecin işini de kanıtlar.
    await createActivity(worker, { title: "Kapsam içi sorusuz" });

    const viewer = { id: manager.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, manager.id);

    const sonuc = await listScopeActivities(
      testDb,
      viewer,
      { period: "all", openQuestions: true },
      NOW,
      { subordinates: asts },
    );

    expect(sonuc.items.map((i) => i.title)).toEqual(["Kendi kaydı"]);
  });

  it("kullanıcının kendi sorduğu soru tek başına listeye girmez", async () => {
    const { manager, worker } = await sirket();
    const kendiSorusu = await createActivity(worker, { title: "Kendi sorusu" });
    await soruAc(kendiSorusu.id, manager.id, worker.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, manager.id);
    const filters = { period: "all" as const, openQuestions: true };

    const [liste, sayac] = await Promise.all([
      listScopeActivities(testDb, viewer, filters, NOW, { subordinates: asts }),
      countScopeActivities(testDb, viewer, filters, NOW, { subordinates: asts }),
    ]);

    expect(liste.items).toHaveLength(0);
    expect(sayac).toBe(0);
  });

  it("kendi sorusu ve başkasının sorusu aynı faaliyeti bir kez gösterir", async () => {
    const { manager, worker, yabanci } = await sirket();
    const faaliyet = await createActivity(worker, { title: "Karışık sorular" });
    await soruAc(faaliyet.id, manager.id, worker.id);
    await soruAc(faaliyet.id, yabanci.id, worker.id);

    const viewer = { id: manager.id, isSystemAdmin: false };
    const asts = await subordinateUserIds(testDb, manager.id);
    const filters = { period: "all" as const, openQuestions: true };

    const [liste, sayac] = await Promise.all([
      listScopeActivities(testDb, viewer, filters, NOW, { subordinates: asts }),
      countScopeActivities(testDb, viewer, filters, NOW, { subordinates: asts }),
    ]);

    expect(liste.items.map((item) => item.id)).toEqual([faaliyet.id]);
    expect(sayac).toBe(1);
  });
});
