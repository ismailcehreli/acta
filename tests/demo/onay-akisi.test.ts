import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { approveActivity } from "@/server/activities/approval";
import { createActivity } from "@/server/activities/write";
import { openFollowUp } from "@/server/follow-ups/service";
import { DEMO_UNIT_NAMES, installDemoData } from "@/server/demo/data";
import {
  DEMO_ORIGIN_REUSED,
  rememberDemoOrgUnitOrigin,
} from "@/server/demo/origin";
import { purgeDemoData } from "@/server/demo/purge";
import { listPendingApprovals } from "@/server/activities/approval";

import {
  createActivity as fixtureFaaliyet,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Örnek veri **üretim yolunun değişmezlerini** kurmalı (denetim
// 23.08.2026, P3-R3-3).
//
// `kararliKayit` bekleyen faaliyeti doğrudan yazıyordu: ne uygun onaylayıcı
// listesi ne açık onay turu doğuyordu. Ekran dolu görünüyor ama denenmek
// istenen akış — kuyrukta gör, karar ver — hiç çalışmıyordu. Ters yönde,
// gerçek servisle yazılmış bir demo kaydın turu temizliği bloke ediyordu.

const NOW = new Date("2026-08-20T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Örnek veri kök birim ister; kurulumun kendisi de sınanıyor. */
async function kurulumYap() {
  const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
  await createUser(kok.id, {
    fullName: "Sistem Yöneticisi",
    email: "yonetici@sirket.test",
    isSystemAdmin: true,
  });

  const sonuc = await installDemoData(testDb);
  if (!sonuc.ok) throw new Error(`örnek veri kurulamadı: ${sonuc.error}`);
}

describe("örnek veri onay akışı", () => {
  it("bekleyen örnek kayıt kuyrukta görünür ve karara bağlanabilir", async () => {
    await kurulumYap();

    const bekleyen = await testDb.activity.findFirstOrThrow({
      where: { approvalStatus: "PENDING_APPROVAL" },
      select: { id: true, approverId: true },
    });

    // Kuyruk `approvalQueueWhere`den geçiyor: uygun onaylayıcı listesi yoksa
    // kayıt hiç görünmez.
    const kuyruk = await listPendingApprovals(testDb, bekleyen.approverId!, NOW);
    expect(kuyruk.map((satir) => satir.id)).toContain(bekleyen.id);

    // Karar servisi açık tur ister; yoksa işlem düşer.
    // Örnek veri gerçek saati kullanıyor; karar gönderimden sonra olmalı.
    const karar = await approveActivity(
      testDb,
      bekleyen.approverId!,
      bekleyen.id,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(karar.ok).toBe(true);
  });

  it("kurulumdan hemen sonra panelden temizlenebilir", async () => {
    // Tasarım ve ekran örnek verinin panelden **bütünüyle** kaldırılacağını
    // söylüyor. Kurulumun bıraktığı denetim izleri "gerçek bir nesneye
    // işaret ediyor" sayıldığı için arada hiçbir kullanıcı işlemi olmadan
    // temizlik engelleniyordu (denetim 23.08.2026, P3-R4-2).
    await kurulumYap();

    const yonetici = await testDb.user.findFirstOrThrow({
      where: { email: { endsWith: "@sirket.test" } },
      select: { id: true },
    });

    const sonuc = await purgeDemoData(testDb, yonetici.id, new Date());

    if (!sonuc.ok) {
      throw new Error(
        `temizlik başarısız: ${sonuc.error} ${"detail" in sonuc ? sonuc.detail : ""}`,
      );
    }

    expect(await testDb.approvalRound.count()).toBe(0);
    expect(
      await testDb.user.count({ where: { email: { endsWith: "@ornek.test" } } }),
    ).toBe(0);
    expect(
      await testDb.orgUnit.count({
        where: { name: { in: [...DEMO_UNIT_NAMES] } },
      }),
    ).toBe(0);
    expect(await testDb.demoObject.count()).toBe(0);
  });

  it("iki müdürlü birimde kayıt ikisinin de kuyruğuna düşer", async () => {
    await kurulumYap();

    const bekleyen = await testDb.activity.findFirstOrThrow({
      where: { approvalStatus: "PENDING_APPROVAL" },
      select: { id: true, authorId: true },
    });

    const yazar = await testDb.user.findUniqueOrThrow({
      where: { id: bekleyen.authorId },
      select: { orgUnitId: true },
    });

    // Aynı birime ikinci bir müdür: örnek veri çoğul müdür kuralını
    // uygulamalı (20.08.2026 kararı; denetim P3-R4-1).
    const ikinciMudur = await createUser(yazar.orgUnitId, {
      fullName: "İkinci Müdür",
      email: "ikinci@ornek.test",
      isUnitManager: true,
    });

    // Kurulum yeniden çalıştırılıyor: "eksik örnek veriyi tamamla".
    const tekrar = await installDemoData(testDb);
    expect(tekrar.ok).toBe(true);

    const kuyruk = await listPendingApprovals(testDb, ikinciMudur.id, new Date());

    expect(kuyruk.map((satir) => satir.id)).toContain(bekleyen.id);
  }, 60_000);

  it("yönetici kararıyla onaylı örnek kayıtların tur geçmişi vardır", async () => {
    await kurulumYap();

    // Onaya tabi birimde yöneticisi karar vermiş gibi duran her kayıt
    // ölçülebilir olmalı; turu olmayan karar skorda hiç görünmez.
    const kararlilar = await testDb.activity.findMany({
      where: { approverId: { not: null }, approvalDecidedAt: { not: null } },
      select: { id: true },
    });

    expect(kararlilar.length).toBeGreaterThan(0);

    const turlu = await testDb.approvalRound.count({
      where: { activityId: { in: kararlilar.map((k) => k.id) }, decidedAt: { not: null } },
    });

    expect(turlu).toBe(kararlilar.length);
  });

  it("silinen ilişkiler ikinci kurulumda onarılır", async () => {
    await kurulumYap();

    const bekleyen = await testDb.activity.findFirstOrThrow({
      where: { approvalStatus: "PENDING_APPROVAL" },
      select: { id: true },
    });

    await testDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL app.demo_purge = 'evet'");
      await tx.approvalRound.deleteMany({ where: { activityId: bekleyen.id } });
      await tx.activityApprover.deleteMany({ where: { activityId: bekleyen.id } });
    });

    const tekrar = await installDemoData(testDb);
    expect(tekrar.ok).toBe(true);

    expect(
      await testDb.approvalRound.count({ where: { activityId: bekleyen.id } }),
    ).toBeGreaterThan(0);
    expect(
      await testDb.activityApprover.count({ where: { activityId: bekleyen.id } }),
    ).toBeGreaterThan(0);
  });

  it("gerçek servisle yazılmış demo kaydın turu temizliği engellemez", async () => {
    // Kurulum elle: `installDemoData`nın bıraktığı denetim izleri temizliği
    // **başka** bir sebeple engelliyor (aşağıdaki nota bakın); burada
    // sınanan şey yalnız onay turunun yabancı anahtarı.
    const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
    const yonetici = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      email: "yonetici@sirket.test",
      isSystemAdmin: true,
      isUnitManager: true,
    });
    const birim = await createOrgUnit({
      name: "Onaya Tabi Birim",
      parentId: kok.id,
      requiresApproval: true,
    });
    await rememberDemoOrgUnitOrigin(testDb, birim.id, DEMO_ORIGIN_REUSED);
    await createUser(birim.id, {
      fullName: "Birim Müdürü",
      email: `mudur@${"ornek.test"}`,
      isUnitManager: true,
    });
    const demo = await createUser(birim.id, {
      fullName: "Demo Çalışan",
      email: `calisan@${"ornek.test"}`,
    });

    // Demo kullanıcı uygulamanın **gerçek** yolundan yazıyor: onaya tabi
    // birimde açık onay turu da doğuyor.
    const yazildi = await createActivity(
      testDb,
      { id: demo.id, orgUnitId: birim.id, requiresApproval: true },
      {
        activityDate: new Date().toISOString().slice(0, 10),
        title: "Gerçek yoldan yazılmış örnek kayıt",
        description: "Temizliğin bu kaydı da götürebilmesi gerekiyor.",
        targetDepartmentIds: [birim.id],
      },
      new Date(),
    );
    if (!yazildi.ok) throw new Error(`kayıt yazılamadı: ${yazildi.error}`);

    expect(await testDb.approvalRound.count()).toBe(1);

    const sonuc = await purgeDemoData(testDb, yonetici.id, new Date());

    if (!sonuc.ok) {
      throw new Error(
        `temizlik başarısız: ${sonuc.error} ${"detail" in sonuc ? sonuc.detail : ""}`,
      );
    }
    expect(await testDb.approvalRound.count()).toBe(0);
  });
});

// Temizlik ile gerçek karar yarışı (denetim 23.08.2026, P3-R4-3).
//
// Engel sorguları silme işleminin **dışında** çalışıyordu. Ön kontrol ile
// silme arasında gerçek bir yönetici demo kaydı onayladığında karar yazılıyor,
// sonra temizlik hiçbir şey görmeden onun **değişmez** onay turunu ve
// faaliyeti siliyordu: P3-R3-1 ile eklenen değişmezlik güvencesi aynı paketin
// temizlik yolundan aşılıyordu.
describe("temizlik ile gerçek karar yarışı", () => {
  it("ön kontrolden sonra verilen gerçek karar silinmez", async () => {
    const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
    const yonetici = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      email: "yonetici@sirket.test",
      isSystemAdmin: true,
    });
    const birim = await createOrgUnit({
      name: "Onaya Tabi Birim",
      parentId: kok.id,
      requiresApproval: true,
    });
    await rememberDemoOrgUnitOrigin(testDb, birim.id, DEMO_ORIGIN_REUSED);
    // **Gerçek** müdür: demo alan adında değil.
    const gercekMudur = await createUser(birim.id, {
      fullName: "Gerçek Müdür",
      email: "mudur@sirket.test",
      isUnitManager: true,
    });
    const demo = await createUser(birim.id, {
      fullName: "Demo Çalışan",
      email: "calisan@ornek.test",
    });

    const yazildi = await createActivity(
      testDb,
      { id: demo.id, orgUnitId: birim.id, requiresApproval: true },
      {
        activityDate: new Date().toISOString().slice(0, 10),
        title: "Yarışa giren örnek kayıt",
        description: "Ön kontrol ile silme arasında karara bağlanacak.",
        targetDepartmentIds: [birim.id],
      },
      new Date(),
    );
    if (!yazildi.ok) throw new Error(`kayıt yazılamadı: ${yazildi.error}`);

    // Temizlik işlemi başlıyor ve **kontrolden önce** bekletiliyor.
    let hazirEt = () => {};
    const hazir = new Promise<void>((c) => (hazirEt = c));
    let birak = () => {};
    const bekle = new Promise<void>((c) => (birak = c));

    const bariyerliDb = new Proxy(testDb, {
      get(hedef, alan) {
        if (alan !== "$transaction") {
          const deger = Reflect.get(hedef, alan);
          return typeof deger === "function" ? deger.bind(hedef) : deger;
        }

        const asil = Reflect.get(hedef, alan) as (
          fn: (tx: unknown) => Promise<unknown>,
        ) => Promise<unknown>;

        return (fn: (tx: unknown) => Promise<unknown>) =>
          asil.call(hedef, async (tx: unknown) => {
            hazirEt();
            await bekle;
            return fn(tx);
          });
      },
    }) as unknown as typeof testDb;

    const temizlik = purgeDemoData(bariyerliDb, yonetici.id, new Date());
    await hazir;

    // Gerçek müdür tam bu pencerede karar veriyor.
    const karar = await approveActivity(
      testDb,
      gercekMudur.id,
      yazildi.activity.id,
      new Date(Date.now() + 60 * 1000),
    );
    expect(karar.ok).toBe(true);

    birak();
    const sonuc = await temizlik;

    // Temizlik durmalı: gerçek bir yöneticinin karar geçmişi silinemez.
    expect(sonuc.ok).toBe(false);
    expect(
      await testDb.approvalRound.count({
        where: { decidedById: gercekMudur.id, decidedAt: { not: null } },
      }),
    ).toBe(1);
    expect(
      await testDb.activity.count({ where: { id: yazildi.activity.id } }),
    ).toBe(1);
  });
});

// Alt nesne yarışı ve birim kökeni (denetim 23.08.2026, P3-R5-1,
// P3-R5-2).
describe("temizlik gerçek veriyi yarışta da korur", () => {
  it("engel kontrolünden sonra kapatılan gerçek takip maddesi silinmez", async () => {
    const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
    const yonetici = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      email: "yonetici@sirket.test",
      isSystemAdmin: true,
    });
    const birim = await createOrgUnit({ name: "Birim", parentId: kok.id });
    await rememberDemoOrgUnitOrigin(testDb, birim.id, DEMO_ORIGIN_REUSED);
    const gercekMudur = await createUser(birim.id, {
      fullName: "Gerçek Müdür",
      email: "mudur@sirket.test",
      isUnitManager: true,
    });
    const demo = await createUser(birim.id, {
      fullName: "Demo Çalışan",
      email: "calisan@ornek.test",
    });

    const kayit = await fixtureFaaliyet(demo, {
      activityDate: new Date("2026-08-03T00:00:00.000Z"),
    });

    // Maddeyi demo kullanıcı açtı; **gerçek** müdür kapatacak.
    const madde = await openFollowUp(
      testDb,
      { id: demo.id, isSystemAdmin: false },
      { activityId: kayit.id, nextStep: "Bekliyor" },
      new Date("2026-08-04T09:00:00.000Z"),
    );
    if (!madde.ok) throw new Error("madde açılamadı");

    // Kapatma işlemi takip satırını kilitleyip commit etmeden bekliyor:
    // temizlik yalnız faaliyeti kilitliyorsa bu pencereden geçerdi.
    let kapatmaHazir = () => {};
    const kapatmaBekliyor = new Promise<void>((c) => (kapatmaHazir = c));
    let devamEt = () => {};
    const devam = new Promise<void>((c) => (devamEt = c));

    const kapatma = testDb.$transaction(async (tx) => {
      await tx.followUpItem.update({
        where: { id: madde.item.id },
        data: {
          status: "CLOSED",
          closedAt: new Date("2026-08-05T09:00:00.000Z"),
          closedById: gercekMudur.id,
          closingNote: "Gerçek müdür kapattı",
        },
      });
      kapatmaHazir();
      await devam;
    });

    await kapatmaBekliyor;

    const temizlik = purgeDemoData(testDb, yonetici.id, new Date());
    await new Promise((c) => setTimeout(c, 150));
    devamEt();
    await kapatma;
    const sonuc = await temizlik;

    // Gerçek müdürün kapattığı madde ve geçmişi duruyor olmalı.
    expect(sonuc.ok).toBe(false);
    expect(
      await testDb.followUpItem.count({ where: { id: madde.item.id } }),
    ).toBe(1);
  });

  it("önceden var olan aynı adlı gerçek birim silinmez", async () => {
    const kok = await createOrgUnit({ name: "Acta HQ", type: "Kök" });
    const yonetici = await createUser(kok.id, {
      fullName: "Sistem Yöneticisi",
      email: "yonetici@sirket.test",
      isSystemAdmin: true,
    });

    // Şirketin **gerçek** ve boş Planlama birimi; adı örnek veriyle aynı.
    const gercekPlanlama = await createOrgUnit({
      name: "Planlama",
      parentId: kok.id,
    });

    const sonuc = await installDemoData(testDb);
    expect(sonuc.ok).toBe(true);

    const temizlik = await purgeDemoData(testDb, yonetici.id, new Date());
    expect(temizlik.ok).toBe(true);

    // Ad bir köken kaydı değildir: kurulum bu birimi **yeniden kullandı**,
    // oluşturmadı; temizlik ona dokunamaz.
    expect(
      await testDb.orgUnit.count({ where: { id: gercekPlanlama.id } }),
    ).toBe(1);
  });
});
