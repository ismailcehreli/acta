import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createActivity as createActivityService } from "@/server/activities/write";
import { approveActivity } from "@/server/activities/approval";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { readScoreTrend } from "@/server/scoring/read";
import {
  SCORE_CALCULATORS,
  SCORE_FORMULA_VERSION,
} from "@/server/scoring/compute";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDatabaseUrl, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
  await saveSettings(testDb, {
    [SETTING_KEYS.scoringEnabled]: "true",
    [SETTING_KEYS.retroactiveEntryDays]: "1",
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne(createdAt = "2026-01-01T00:00:00.000Z") {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birim = await createOrgUnit({
    name: "Kalıphane",
    parentId: kok.id,
    requiresApproval: false,
  });
  const kisi = await createUser(birim.id, { fullName: "Kadir Usta" });
  await testDb.user.update({
    where: { id: kisi.id },
    data: { createdAt: new Date(createdAt) },
  });
  return { kok, birim, kisi };
}

describe("Paket 8 dördüncü tur karşı örnekleri", () => {
  it("donmuş aya sonradan kabul edilen faaliyet yeni skor sürümü üretir", async () => {
    const { birim, kisi } = await sahne();
    await createActivity(kisi, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    expect(
      await testDb.userScorePeriod.count({
        where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      }),
    ).toBe(1);

    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });
    const gec = await createActivityService(
      testDb,
      { id: kisi.id, orgUnitId: birim.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Geç ama kurala uygun",
        description: "Yeni ayar bu tarihi kabul ediyor.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );
    expect(gec.ok).toBe(true);

    await closeScorePeriod(testDb, new Date("2026-08-03T06:01:00.000Z"));

    expect(
      await testDb.userScorePeriod.count({
        where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      }),
      "eski karne korunmalı, düzeltme ikinci sürüm olmalı",
    ).toBe(2);

    const latest = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      orderBy: { revisionNo: "desc" },
      select: { revisionNo: true, total: true },
    });
    const trend = await readScoreTrend(
      testDb,
      { id: kisi.id, isSystemAdmin: false },
      kisi.id,
    );
    expect(latest.revisionNo).toBe(2);
    expect(trend.periods).toEqual([
      { periodStart: "2026-07-01", total: latest.total },
    ]);
  });

  it("iki ay kapalı kalan işçi bütün uygun eksik ayları eskiden yeniye yakalar", async () => {
    const { kisi } = await sahne("2026-07-01T00:00:00.000Z");
    await testDb.scoreHistoryControl.create({
      data: { id: 1, historyStart: new Date("2026-07-01") },
    });

    for (const tarih of ["2026-07-15", "2026-08-17", "2026-09-15"]) {
      await createActivity(kisi, {
        activityDate: new Date(`${tarih}T00:00:00.000Z`),
      });
    }

    const now = new Date("2026-10-10T06:00:00.000Z");
    await closeScorePeriod(testDb, now);
    await closeScorePeriod(testDb, now);
    await closeScorePeriod(testDb, now);

    const donemler = await testDb.userScorePeriod.findMany({
      where: { userId: kisi.id, frozen: true },
      orderBy: { periodStart: "asc" },
      select: { periodStart: true },
    });
    expect(donemler.map((d) => d.periodStart.toISOString().slice(0, 10))).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("90 günlük geçerli ayar uygun hâle gelen eski ayı kalıcı olarak atlamaz", async () => {
    const { kisi } = await sahne("2026-07-01T00:00:00.000Z");
    await testDb.scoreHistoryControl.create({
      data: { id: 1, historyStart: new Date("2026-07-01") },
    });
    await createActivity(kisi, {
      activityDate: new Date("2026-07-15T00:00:00.000Z"),
    });
    await testDb.scoreSettingEvent.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "90",
        effectiveAt: new Date("2026-07-31T20:59:00.000Z"),
        reason: "TEST_PERIOD_END_SETTING",
      },
    });

    const sonuc = await closeScorePeriod(
      testDb,
      new Date("2026-11-01T06:00:00.000Z"),
    );
    expect(sonuc.periodStart).toBe("2026-07-01");
  });

  it("dönem ortasında başlayan kişinin paydası işe giriş gününde başlar", async () => {
    const { kisi } = await sahne("2026-07-20T09:00:00.000Z");

    await closeScorePeriod(testDb, new Date("2026-08-25T12:00:00.000Z"));

    const donem = await testDb.userScorePeriod.findFirstOrThrow({
      where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      select: { expectedDays: true },
    });
    expect(donem.expectedDays).toBe(10);
  });

  it("kapanış yazdığı sürümün kayıtlı hesaplayıcısını gerçekten çağırır", async () => {
    const { kisi } = await sahne();
    const asil = SCORE_CALCULATORS[SCORE_FORMULA_VERSION];
    const hesaplayici = vi.fn(() => ({
      regularity: 1,
      acceptance: null,
      approval: null,
      followUp: 6,
      total: 7,
    }));
    SCORE_CALCULATORS[SCORE_FORMULA_VERSION] = hesaplayici;

    try {
      await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
      const donem = await testDb.userScorePeriod.findFirstOrThrow({
        where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
        select: { total: true, formulaVersion: true },
      });

      expect(hesaplayici).toHaveBeenCalledOnce();
      expect(donem).toEqual({ total: 7, formulaVersion: SCORE_FORMULA_VERSION });
    } finally {
      SCORE_CALCULATORS[SCORE_FORMULA_VERSION] = asil;
    }
  });

  it("V2 ile kapatılan yeni dönem V2 sonucunu ve etiketini birlikte taşır", async () => {
    const { kok, kisi } = await sahne();
    const yonetici = await createUser(kok.id, {
      fullName: "Genel Müdür",
      isUnitManager: true,
      isScored: false,
      writesActivities: false,
    });
    const v2 = vi.fn(() => ({
      regularity: 2,
      acceptance: null,
      approval: null,
      followUp: 6,
      total: 8,
    }));
    const eskiV2 = SCORE_CALCULATORS[2];
    SCORE_CALCULATORS[2] = v2;

    try {
      await closeScorePeriod(
        testDb,
        new Date("2026-08-02T06:00:00.000Z"),
        { formulaVersion: 2 },
      );
      const donem = await testDb.userScorePeriod.findFirstOrThrow({
        where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
        select: { total: true, formulaVersion: true },
      });
      expect(v2).toHaveBeenCalledOnce();
      expect(donem).toEqual({ total: 8, formulaVersion: 2 });

      const trend = await readScoreTrend(
        testDb,
        { id: kisi.id, isSystemAdmin: false },
        kisi.id,
      );
      expect(trend.periods).toEqual([{ periodStart: "2026-07-01", total: 8 }]);
      const yoneticiTrendi = await readScoreTrend(
        testDb,
        { id: yonetici.id, isSystemAdmin: false },
        kisi.id,
      );
      expect(yoneticiTrendi.periods).toEqual([
        { periodStart: "2026-07-01", total: 8 },
      ]);
    } finally {
      SCORE_CALCULATORS[2] = eskiV2;
    }
  });
});

describe("skor düzeltme kuyruğunun işlem güvenliği", () => {
  it("ilk kapanışla yarışan karar ne ilk sürümden ne düzeltme kuyruğundan düşer", async () => {
    const kok = await createOrgUnit({ name: "Yarış Şirketi", type: "Kök" });
    const birim = await createOrgUnit({
      name: "Yarış Birimi",
      parentId: kok.id,
      requiresApproval: true,
    });
    const yonetici = await createUser(kok.id, {
      fullName: "Yarış Müdürü",
      isUnitManager: true,
      isScored: false,
      writesActivities: false,
    });
    const kisi = await createUser(birim.id, { fullName: "Yarış Çalışanı" });
    await testDb.user.update({
      where: { id: kisi.id },
      data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    const kayit = await createActivityService(
      testDb,
      { id: kisi.id, orgUnitId: birim.id, requiresApproval: true },
      {
        activityDate: "2026-07-15",
        title: "Kapanışla yarışan karar",
        description: "Karar iki skor sürümünün arasına düşmemeli.",
        targetDepartmentIds: [],
      },
      new Date("2026-07-15T09:00:00.000Z"),
    );
    if (!kayit.ok) throw new Error(kayit.message);

    let kapanisHazirEt = () => {};
    const kapanisHazir = new Promise<void>((coz) => (kapanisHazirEt = coz));
    let kapanisiBirak = () => {};
    const kapanisBekle = new Promise<void>((coz) => (kapanisiBirak = coz));

    const bariyerliKapanisDb = {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) => {
          let ilkKilit = true;
          const proxy = new Proxy(tx, {
            get(hedef, alan) {
              if (alan !== "$executeRaw") {
                const deger = Reflect.get(hedef, alan);
                return typeof deger === "function" ? deger.bind(hedef) : deger;
              }

              const asil = Reflect.get(hedef, alan) as (
                ...args: unknown[]
              ) => Promise<unknown>;
              return async (...args: unknown[]) => {
                const sonuc = await asil.apply(hedef, args);
                if (ilkKilit) {
                  ilkKilit = false;
                  kapanisHazirEt();
                  await kapanisBekle;
                }
                return sonuc;
              };
            },
          });
          return fn(proxy);
        })) as typeof testDb.$transaction,
    } as unknown as typeof testDb;

    const ikinci = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    let kararPidHazirEt!: (pid: number) => void;
    const kararPidHazir = new Promise<number>((coz) => (kararPidHazirEt = coz));
    const pidIzleyenDb = {
      ...ikinci,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        ikinci.$transaction(async (tx) => {
          const [satir] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid()::int AS pid
          `;
          if (!satir) throw new Error("Karar bağlantısının pid değeri okunamadı.");
          kararPidHazirEt(satir.pid);
          return fn(tx);
        })) as typeof ikinci.$transaction,
    } as unknown as typeof ikinci;

    let kapanis: ReturnType<typeof closeScorePeriod> | null = null;
    let karar: ReturnType<typeof approveActivity> | null = null;
    try {
      kapanis = closeScorePeriod(
        bariyerliKapanisDb,
        new Date("2026-08-02T06:00:00.000Z"),
      );
      await kapanisHazir;

      karar = approveActivity(
        pidIzleyenDb,
        yonetici.id,
        kayit.activity.id,
        new Date("2026-08-02T06:00:01.000Z"),
      );
      const kararPid = await kararPidHazir;

      let advisoryBekliyor = false;
      for (let deneme = 0; deneme < 100; deneme += 1) {
        const [satir] = await testDb.$queryRaw<Array<{ bekliyor: boolean }>>`
          SELECT ("wait_event_type" = 'Lock' AND "wait_event" = 'advisory') AS bekliyor
          FROM pg_stat_activity
          WHERE pid = ${kararPid}
        `;
        if (satir?.bekliyor) {
          advisoryBekliyor = true;
          break;
        }
        await new Promise((coz) => setTimeout(coz, 10));
      }
      expect(advisoryBekliyor).toBe(true);

      kapanisiBirak();
      await kapanis;
      expect((await karar).ok).toBe(true);
    } finally {
      kapanisiBirak();
      const tamamlanacak: Promise<unknown>[] = [];
      if (kapanis) tamamlanacak.push(kapanis);
      if (karar) tamamlanacak.push(karar);
      await Promise.allSettled(tamamlanacak);
      await ikinci.$disconnect();
    }

    const bekleyenIstek =
      await testDb.scoreRecalculationRequest.findFirstOrThrow({
        where: { processedAt: null },
        select: { id: true },
      });

    await closeScorePeriod(testDb, new Date("2026-08-02T06:01:00.000Z"));
    const surumler = await testDb.userScorePeriod.findMany({
      where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true, sourceRequestId: true },
    });
    expect(surumler).toEqual([
      { revisionNo: 1, sourceRequestId: null },
      { revisionNo: 2, sourceRequestId: bekleyenIstek.id },
    ]);
    expect(
      await testDb.scoreRecalculationRequest.findUniqueOrThrow({
        where: { id: bekleyenIstek.id },
        select: { processedAt: true },
      }),
    ).toEqual({ processedAt: expect.any(Date) });
  });

  it("kuyruk yazılamazsa geç faaliyet de oluşmaz", async () => {
    const { birim, kisi } = await sahne();
    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });

    const kuyruguPatlayan = {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(hedef, alan) {
                if (alan === "scoreRecalculationRequest") {
                  return {
                    upsert: async () => {
                      throw new Error("skor kuyruğu yazılamadı");
                    },
                  };
                }
                return Reflect.get(hedef, alan);
              },
            }),
          ),
        )) as typeof testDb.$transaction,
    } as unknown as typeof testDb;

    await expect(
      createActivityService(
        kuyruguPatlayan,
        { id: kisi.id, orgUnitId: birim.id, requiresApproval: false },
        {
          activityDate: "2026-07-31",
          title: "Yarım kalmaması gereken faaliyet",
          description: "Kuyruk yazılamazsa bu kayıt da geri alınır.",
          targetDepartmentIds: [],
        },
        new Date("2026-08-03T06:00:00.000Z"),
      ),
    ).rejects.toThrow("skor kuyruğu yazılamadı");

    expect(
      await testDb.activity.count({
        where: { title: "Yarım kalmaması gereken faaliyet" },
      }),
    ).toBe(0);
    expect(await testDb.scoreRecalculationRequest.count()).toBe(0);
  });

  it("düzeltme hesabı çökerse eski sürüm görünür kalır ve istek yeniden denenir", async () => {
    const { birim, kisi } = await sahne();
    await closeScorePeriod(
      testDb,
      new Date("2026-08-02T06:00:00.000Z"),
      { formulaVersion: 1 },
    );
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });
    await createActivityService(
      testDb,
      { id: kisi.id, orgUnitId: birim.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Yeniden denenecek faaliyet",
        description: "İlk hesap çökecek, ikinci hesap tamamlanacak.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );

    const asil = SCORE_CALCULATORS[1];
    SCORE_CALCULATORS[1] = () => {
      throw new Error("hesaplayıcı geçici olarak kullanılamıyor");
    };
    try {
      await expect(
        closeScorePeriod(
          testDb,
          new Date("2026-08-03T06:01:00.000Z"),
          { formulaVersion: 1 },
        ),
      ).rejects.toThrow("hesaplayıcı geçici olarak kullanılamıyor");
    } finally {
      SCORE_CALCULATORS[1] = asil;
    }

    expect(
      await testDb.userScorePeriod.count({
        where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      }),
    ).toBe(1);
    const bekleyen = await testDb.scoreRecalculationRequest.findFirstOrThrow();
    expect(bekleyen).toMatchObject({ attempts: 1, processedAt: null });
    expect(bekleyen.lastError).toContain(
      "hesaplayıcı geçici olarak kullanılamıyor",
    );

    await closeScorePeriod(testDb, new Date("2026-08-03T06:02:00.000Z"));
    expect(
      await testDb.userScorePeriod.count({
        where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      }),
    ).toBe(2);
    expect(
      await testDb.scoreRecalculationRequest.findUniqueOrThrow({
        where: { id: bekleyen.id },
        select: { attempts: true, processedAt: true, lastError: true },
      }),
    ).toMatchObject({ attempts: 2, lastError: null });
  });

  it("hata, işlemden önce görülmüş bayat isteğe değil gerçekten işlenen isteğe yazılır", async () => {
    const { birim, kisi } = await sahne();
    await closeScorePeriod(
      testDb,
      new Date("2026-08-02T06:00:00.000Z"),
      { formulaVersion: 1 },
    );
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });

    const bayat = await testDb.scoreRecalculationRequest.create({
      data: {
        userId: kisi.id,
        periodStart: new Date("2026-07-01"),
        sourceType: "TEST_PROCESSED",
        sourceId: "önceden-bitmiş",
        requestedAt: new Date("2026-08-03T05:00:00.000Z"),
        processedAt: new Date("2026-08-03T05:01:00.000Z"),
        attempts: 1,
      },
    });
    await createActivityService(
      testDb,
      { id: kisi.id, orgUnitId: birim.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Gerçek bekleyen istek",
        description: "Hata bu isteğe yazılmalı.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );
    const gercek = await testDb.scoreRecalculationRequest.findFirstOrThrow({
      where: { processedAt: null },
    });

    // Eski uygulama kuyruk kimliğini transaction kilidinden önce okuyordu.
    // Bu sarmalayıcı tam o okumaya artık bitmiş bir satır döndürür; işlenen
    // gerçek istek yalnız transaction içindeki sorguda görünür.
    const bayatOnOkumaliDb = {
      ...testDb,
      scoreRecalculationRequest: {
        findFirst: async () => ({ id: bayat.id }),
        updateMany: (...args: Parameters<typeof testDb.scoreRecalculationRequest.updateMany>) =>
          testDb.scoreRecalculationRequest.updateMany(...args),
      },
    } as unknown as typeof testDb;

    const asil = SCORE_CALCULATORS[1];
    SCORE_CALCULATORS[1] = () => {
      throw new Error("işlenen istek çöktü");
    };
    try {
      await expect(
        closeScorePeriod(
          bayatOnOkumaliDb,
          new Date("2026-08-03T06:01:00.000Z"),
          { formulaVersion: 1 },
        ),
      ).rejects.toThrow("işlenen istek çöktü");
    } finally {
      SCORE_CALCULATORS[1] = asil;
    }

    expect(
      await testDb.scoreRecalculationRequest.findUniqueOrThrow({
        where: { id: gercek.id },
        select: { attempts: true, lastError: true },
      }),
    ).toMatchObject({ attempts: 1 });
    expect(
      (
        await testDb.scoreRecalculationRequest.findUniqueOrThrow({
          where: { id: gercek.id },
          select: { lastError: true },
        })
      ).lastError,
    ).toContain("işlenen istek çöktü");
  });

  it("iki işçi aynı düzeltme isteğinden yalnız bir yeni sürüm üretir", async () => {
    const { birim, kisi } = await sahne();
    await closeScorePeriod(testDb, new Date("2026-08-02T06:00:00.000Z"));
    await saveSettings(testDb, {
      [SETTING_KEYS.retroactiveEntryDays]: "5",
    });
    await createActivityService(
      testDb,
      { id: kisi.id, orgUnitId: birim.id, requiresApproval: false },
      {
        activityDate: "2026-07-31",
        title: "Tek düzeltme sürümü",
        description: "İki işçi aynı isteği çift yazmamalı.",
        targetDepartmentIds: [],
      },
      new Date("2026-08-03T06:00:00.000Z"),
    );

    const ikinci = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    try {
      const sonuclar = await Promise.allSettled([
        closeScorePeriod(testDb, new Date("2026-08-03T06:01:00.000Z")),
        closeScorePeriod(ikinci, new Date("2026-08-03T06:01:00.000Z")),
      ]);
      expect(sonuclar.every((sonuc) => sonuc.status === "fulfilled")).toBe(true);
    } finally {
      await ikinci.$disconnect();
    }

    const surumler = await testDb.userScorePeriod.findMany({
      where: { userId: kisi.id, periodStart: new Date("2026-07-01") },
      orderBy: { revisionNo: "asc" },
      select: { revisionNo: true },
    });
    expect(surumler).toEqual([{ revisionNo: 1 }, { revisionNo: 2 }]);
    expect(
      await testDb.scoreRecalculationRequest.count({
        where: { processedAt: null },
      }),
    ).toBe(0);
  });
});
