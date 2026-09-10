import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { buildHealthReport } from "@/server/health/report";
import {
  DELAY_FACTOR,
  JOB_NAMES,
  describeJob,
  listJobHealth,
  recordJobFailure,
  recordJobSuccess,
  worstLagSeconds,
} from "@/server/jobs/status";
import { alertOnDelayedJobs } from "@/worker/jobs/alert";
import { SETTING_KEYS, saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Zamanlanmış iş izleme (§12.4). Zamanlayıcı durursa sistem çalışıyor görünür
// ama süreçler sessizce ölür — tespit edilmesi en zor arıza türü budur.

const NOW = new Date("2026-08-18T12:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("gecikme hesabı", () => {
  const temel = {
    jobName: "deneme",
    lastError: null,
    expectedIntervalMinutes: 1,
  };

  it("beklenen aralık içinde çalışan iş gecikmiş sayılmaz", () => {
    const sonuc = describeJob(
      { ...temel, lastSuccessAt: new Date(NOW.getTime() - 30_000) },
      NOW,
    );

    expect(sonuc.lagSeconds).toBe(30);
    expect(sonuc.delayed).toBe(false);
  });

  it("iki katı sınırında henüz gecikmiş sayılmaz", () => {
    const sinir = 1 * 60 * DELAY_FACTOR * 1000;
    const sonuc = describeJob(
      { ...temel, lastSuccessAt: new Date(NOW.getTime() - sinir) },
      NOW,
    );

    expect(sonuc.delayed).toBe(false);
  });

  it("iki katı aşılınca gecikmiş sayılır", () => {
    const sinir = 1 * 60 * DELAY_FACTOR * 1000;
    const sonuc = describeJob(
      { ...temel, lastSuccessAt: new Date(NOW.getTime() - sinir - 1000) },
      NOW,
    );

    expect(sonuc.delayed).toBe(true);
  });

  it("hiç çalışmamış iş gecikmiş sayılır", () => {
    const sonuc = describeJob({ ...temel, lastSuccessAt: null }, NOW);

    // "Hiç çalışmadı" bir sağlık durumu değil, arızadır.
    expect(sonuc.lagSeconds).toBeNull();
    expect(sonuc.delayed).toBe(true);
  });

  it("beklenen aralık uzunsa eşik de uzar", () => {
    const sonuc = describeJob(
      {
        ...temel,
        expectedIntervalMinutes: 60,
        lastSuccessAt: new Date(NOW.getTime() - 90 * 60_000),
      },
      NOW,
    );

    // 90 dakika, saatlik bir işin iki katı eşiğinin (120 dk) altında.
    expect(sonuc.delayed).toBe(false);
  });
});

describe("nabız kaydı", () => {
  it("başarı yazılır ve önceki hata temizlenir", async () => {
    await recordJobFailure(testDb, JOB_NAMES.notificationDispatch, "SMTP yok");
    await recordJobSuccess(testDb, JOB_NAMES.notificationDispatch, NOW);

    const kayit = await testDb.scheduledJobStatus.findUniqueOrThrow({
      where: { jobName: JOB_NAMES.notificationDispatch },
    });
    expect(kayit.lastSuccessAt).toEqual(NOW);
    expect(kayit.lastError).toBeNull();
  });

  it("hata son başarılı çalışma zamanını silmez", async () => {
    await recordJobSuccess(testDb, JOB_NAMES.notificationDispatch, NOW);
    await recordJobFailure(testDb, JOB_NAMES.notificationDispatch, "bağlantı koptu");

    const kayit = await testDb.scheduledJobStatus.findUniqueOrThrow({
      where: { jobName: JOB_NAMES.notificationDispatch },
    });
    // Gecikme hesabı buna dayanıyor; hata onu silmemeli.
    expect(kayit.lastSuccessAt).toEqual(NOW);
    expect(kayit.lastError).toBe("bağlantı koptu");
  });

  it("kaydı hiç olmayan iş de listede görünür ve gecikmiş sayılır", async () => {
    const jobs = await listJobHealth(testDb, NOW);

    expect(jobs).toHaveLength(Object.values(JOB_NAMES).length);
    expect(jobs.every((job) => job.delayed)).toBe(true);
    // Listede görünmeyen iş sağlıklı sanılırdı.
    expect(jobs.map((j) => j.jobName)).toContain(JOB_NAMES.overdueAnswerReminder);
  });

  it("en kötü gecikme raporlanır", async () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }
    await recordJobSuccess(
      testDb,
      JOB_NAMES.notificationDispatch,
      new Date(NOW.getTime() - 45_000),
    );

    const jobs = await listJobHealth(testDb, NOW);
    expect(worstLagSeconds(jobs)).toBe(45);
  });
});

describe("gecikme alarmı (§12.4)", () => {
  async function sistemYoneticisi(email?: string) {
    // Ağaçta tek kök olabilir; ikinci çağrı mevcut kökü kullanır.
    const mevcut = await testDb.orgUnit.findFirst({ where: { parentId: null } });
    const unit = mevcut ?? (await createOrgUnit({ name: "Şirket", type: "Kök" }));

    return createUser(unit.id, {
      fullName: "Sistem Yöneticisi",
      isSystemAdmin: true,
      ...(email ? { email } : {}),
    });
  }

  it("gecikme yoksa alarm yazılmaz", async () => {
    await sistemYoneticisi();
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }

    const sonuc = await alertOnDelayedJobs(testDb, NOW);

    expect(sonuc.delayedJobs).toEqual([]);
    expect(sonuc.queued).toBe(0);
  });

  it("gecikmiş iş için sistem yöneticisine alarm yazılır", async () => {
    const admin = await sistemYoneticisi();
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }
    await recordJobSuccess(
      testDb,
      JOB_NAMES.notificationDispatch,
      new Date(NOW.getTime() - 10 * 60_000),
    );

    const sonuc = await alertOnDelayedJobs(testDb, NOW);

    expect(sonuc.delayedJobs).toEqual([JOB_NAMES.notificationDispatch]);
    expect(sonuc.queued).toBe(1);
    const kuyruk = await testDb.notificationQueue.findMany({
      where: { eventType: "job_delayed" },
    });
    expect(kuyruk).toHaveLength(1);
    expect(kuyruk[0].userId).toBe(admin.id);
  });

  it("aynı gün içinde ikinci alarm yazılmaz, ertesi gün tekrarlanır", async () => {
    await sistemYoneticisi();
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 60 * 60_000));
    }

    const ilk = await alertOnDelayedJobs(testDb, NOW);
    const izlenenIsSayisi = Object.values(JOB_NAMES).length - 1;
    expect(ilk.queued).toBe(izlenenIsSayisi);

    // Aynı gün: 24 saatlik varsayılan tekrar aralığında yağmura dönmez.
    const ikinci = await alertOnDelayedJobs(
      testDb,
      new Date("2026-08-18T12:30:00.000Z"),
    );
    expect(ikinci.queued).toBe(0);

    // Ertesi gün: arıza sürüyorsa uyarı tekrarlanır.
    const ertesiGun = await alertOnDelayedJobs(
      testDb,
      new Date("2026-08-19T12:00:00.000Z"),
    );
    expect(ertesiGun.queued).toBe(izlenenIsSayisi);
  });

  it("pasif sistem yöneticisine alarm gitmez", async () => {
    // Şirkette **hiç** aktif sistem yöneticisi kalmaması artık mümkün değil
    // (veritabanı değişmezi, bulgu 6): son yöneticinin yetkisi
    // kaldırılamaz ve pasifleştirilemez. O yüzden sınanan şey "kimseye
    // gitmiyor" değil, **yalnız aktif olanlara gidiyor**.
    const aktif = await sistemYoneticisi();
    const pasif = await sistemYoneticisi("pasif-yonetici@ornek.test");

    await testDb.user.update({
      where: { id: pasif.id },
      data: { isActive: false, isUnitManager: false },
    });

    const sonuc = await alertOnDelayedJobs(testDb, NOW);

    expect(sonuc.delayedJobs.length).toBeGreaterThan(0);
    expect(sonuc.queued).toBe(sonuc.delayedJobs.length);

    // Pasif yöneticinin kuyruğunda hiçbir şey yok; aktif olanınkinde var.
    expect(await testDb.notificationQueue.count({ where: { userId: pasif.id } })).toBe(0);
    expect(
      await testDb.notificationQueue.count({ where: { userId: aktif.id } }),
    ).toBeGreaterThan(0);
  });

  it("yedek izlemesi kapalıyken hiç alınmamış yedek alarm üretmez", async () => {
    const admin = await sistemYoneticisi();
    for (const jobName of Object.values(JOB_NAMES)) {
      if (jobName !== JOB_NAMES.backup) {
        await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
      }
    }

    const kapali = await alertOnDelayedJobs(testDb, NOW);
    expect(kapali.delayedJobs).not.toContain(JOB_NAMES.backup);
    expect(kapali.queued).toBe(0);

    await saveSettings(testDb, {
      [SETTING_KEYS.backupMonitoringEnabled]: "true",
    });

    const acik = await alertOnDelayedJobs(testDb, NOW);
    expect(acik.delayedJobs).toEqual([JOB_NAMES.backup]);
    expect(acik.queued).toBe(1);
    expect(
      await testDb.notificationQueue.count({ where: { userId: admin.id } }),
    ).toBe(1);
  });

  it("gecikme alarmı tamamen kapatılabilir", async () => {
    await sistemYoneticisi();
    await recordJobFailure(testDb, JOB_NAMES.notificationDispatch, "işleyici durdu");
    await saveSettings(testDb, {
      [SETTING_KEYS.jobDelayAlertEnabled]: "false",
    });

    const sonuc = await alertOnDelayedJobs(testDb, NOW);

    expect(sonuc).toEqual({ delayedJobs: [], queued: 0 });
    expect(await testDb.notificationQueue.count()).toBe(0);
  });
});

describe("sağlık raporu gerçek veriye bağlı", () => {
  it("kuyruk derinliği ve gecikme ölçülür", async () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      await recordJobSuccess(testDb, jobName, new Date(NOW.getTime() - 10_000));
    }

    const report = await buildHealthReport({
      pingDatabase: async () => undefined,
      now: () => NOW,
      queueDepth: async () => 7,
      schedulerLag: async () => ({ lagSeconds: 10, delayed: false }),
    });

    expect(report.status).toBe("ok");
    expect(report.notificationQueue).toEqual({
      status: "ok",
      depth: 7,
      source: "live",
    });
    expect(report.scheduler).toEqual({
      status: "ok",
      lagSeconds: 10,
      source: "live",
    });
  });

  it("gecikmiş zamanlayıcı raporu 'down' yapar", async () => {
    const report = await buildHealthReport({
      pingDatabase: async () => undefined,
      now: () => NOW,
      queueDepth: async () => 0,
      schedulerLag: async () => ({ lagSeconds: 900, delayed: true }),
    });

    // Zamanlayıcı durduğunda sistem "çalışıyor" demeye devam etmemeli.
    expect(report.scheduler.status).toBe("down");
    expect(report.status).toBe("down");
  });

  it("veritabanı yoksa diğer ölçümler denenmez", async () => {
    let kuyrukSoruldu = false;

    const report = await buildHealthReport({
      pingDatabase: async () => {
        throw new Error("bağlantı yok");
      },
      now: () => NOW,
      queueDepth: async () => {
        kuyrukSoruldu = true;
        return 0;
      },
      schedulerLag: async () => ({ lagSeconds: 0, delayed: false }),
    });

    expect(kuyrukSoruldu).toBe(false);
    expect(report.status).toBe("down");
    expect(report.notificationQueue.source).toBe("placeholder");
  });
});

describe("yedek işi (§15.6)", () => {
  it("günlük aralıkla izlenir, dakikalık eşikle değil", async () => {
    const jobs = await listJobHealth(testDb, NOW);
    const yedek = jobs.find((job) => job.jobName === JOB_NAMES.backup);

    expect(yedek).toBeDefined();
    // Günde bir alınan yedeğe bir dakikalık eşikle bakmak her turda alarm
    // üretirdi.
    expect(yedek?.expectedIntervalMinutes).toBe(24 * 60);
  });

  it("yedek 48 saat gecikince alarm eşiğini aşar", async () => {
    await recordJobSuccess(
      testDb,
      JOB_NAMES.backup,
      new Date(NOW.getTime() - 47 * 3_600_000),
      24 * 60,
    );

    let jobs = await listJobHealth(testDb, NOW);
    expect(jobs.find((j) => j.jobName === JOB_NAMES.backup)?.delayed).toBe(false);

    await recordJobSuccess(
      testDb,
      JOB_NAMES.backup,
      new Date(NOW.getTime() - 49 * 3_600_000),
      24 * 60,
    );

    jobs = await listJobHealth(testDb, NOW);
    // Yedek alınmaması sessizce geçmez: mevcut alarm yoluna düşer (§12.4).
    expect(jobs.find((j) => j.jobName === JOB_NAMES.backup)?.delayed).toBe(true);
  });
});
