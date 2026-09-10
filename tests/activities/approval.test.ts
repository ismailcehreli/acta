import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveActivity,
  listPendingApprovals,
  rejectActivity,
  requestChanges,
} from "@/server/activities/approval";
import { createActivity, updateActivity } from "@/server/activities/write";
import { canViewActivity } from "@/server/authz/visibility";
import { AUDIT_ACTIONS } from "@/server/audit/log";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { markActivityAsRead } from "@/server/reads/service";
import { SETTING_KEYS } from "@/server/settings/system-settings";

import {
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Onay akışı (§5.4 durum modeli, §8.2 yetki matrisi).
//
// Ürün sahibi kararı (19.08.2026): müdür süzgeç olur, süzülmemiş içerik üst
// yönetime akmaz.

const NOW = new Date("2026-08-18T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const gm = await createOrgUnit({ name: "Genel Müdürlük", parentId: root.id });
  const kaliphane = await createOrgUnit({
    name: "Kalıphane",
    parentId: gm.id,
    // Bu birimin faaliyetleri onaya tabidir (§4.3).
    requiresApproval: true,
  });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: gm.id });

  const baskan = await createUser(root.id, {
    fullName: "YK Başkanı",
    isUnitManager: true,
  });
  const genelMudur = await createUser(gm.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const mudur = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Kalıpçı" });
  const akran = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  return { baskan, genelMudur, mudur, calisan, akran, kaliphane };
}

function girdi(baslik = "Kalıp bakımı") {
  return {
    activityDate: "2026-08-18",
    title: baslik,
    description: "Haftalık bakım yapıldı.",
    targetDepartmentIds: [] as string[],
  };
}

async function yaz(calisan: { id: string; orgUnitId: string }, baslik?: string) {
  const sonuc = await createActivity(
    testDb,
    { id: calisan.id, orgUnitId: calisan.orgUnitId, requiresApproval: true },
    girdi(baslik),
    NOW,
  );
  if (!sonuc.ok) throw new Error(`kurulum: ${sonuc.message}`);
  return sonuc.activity;
}

describe("kaydın doğduğu durum (§5.4)", () => {
  it("onaya tabi birimde onay bekleyerek doğar ve onaylayıcısı müdürdür", async () => {
    const { calisan, mudur } = await sirket();

    const activity = await yaz(calisan);

    expect(activity.approvalStatus).toBe("PENDING_APPROVAL");
    expect(activity.approverId).toBe(mudur.id);
  });

  it("onaya tabi olmayan birimde doğrudan onaylı doğar", async () => {
    const { akran } = await sirket();

    const sonuc = await createActivity(
      testDb,
      { id: akran.id, orgUnitId: akran.orgUnitId, requiresApproval: false },
      girdi(),
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.activity.approvalStatus).toBe("APPROVED");
    expect(sonuc.activity.approverId).toBeNull();
  });

  it("yöneticisi yoksa kayıt kaybolmaz, hata durumunda bekler (§4.4)", async () => {
    const yalniz = await createOrgUnit({ name: "Yalnız", type: "Kök" });
    const kisi = await createUser(yalniz.id, { fullName: "Tek Kişi" });

    const sonuc = await createActivity(
      testDb,
      { id: kisi.id, orgUnitId: kisi.orgUnitId, requiresApproval: true },
      girdi(),
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.activity.approvalStatus).toBe("MANAGER_NOT_FOUND");
  });

  it("onay bekleyen kayıt onaylayıcısına bildirim üretir", async () => {
    const { calisan, mudur } = await sirket();

    const activity = await yaz(calisan);

    const kuyruk = await testDb.notificationQueue.findMany({
      where: { eventType: NOTIFICATION_EVENTS.approvalPending },
    });
    expect(kuyruk).toHaveLength(1);
    expect(kuyruk[0].userId).toBe(mudur.id);
    expect(kuyruk[0].payload).toMatchObject({ activityId: activity.id });
  });
});

describe("§8.2 — onay sürecindeki kaydı kim görür", () => {
  it("yalnız yazan ve onaylayıcı görür; üst kademeler ve akran görmez", async () => {
    const { calisan, mudur, genelMudur, baskan, akran } = await sirket();
    const activity = await yaz(calisan);

    const bakis = async (id: string, isSystemAdmin = false) =>
      canViewActivity(testDb, { id, isSystemAdmin }, activity);

    expect(await bakis(calisan.id)).toBe("full");
    expect(await bakis(mudur.id)).toBe("full");

    // Asıl iddia: süzülmemiş içerik yukarı akmıyor.
    expect(await bakis(genelMudur.id)).toBe("none");
    expect(await bakis(baskan.id)).toBe("none");
    expect(await bakis(akran.id)).toBe("none");
  });

  it("onaylandıktan sonra üst kademeler görür", async () => {
    const { calisan, mudur, genelMudur, baskan } = await sirket();
    const activity = await yaz(calisan);

    await approveActivity(testDb, mudur.id, activity.id, NOW);
    const guncel = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });

    for (const viewer of [genelMudur, baskan]) {
      expect(
        await canViewActivity(testDb, { id: viewer.id, isSystemAdmin: false }, guncel),
      ).toBe("full");
    }
  });
});

describe("onaylama", () => {
  it("müdür onaylar; durum ve karar anı yazılır", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    const sonuc = await approveActivity(testDb, mudur.id, activity.id, NOW);

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("APPROVED");
    expect(stored.approvalDecidedAt).toEqual(NOW);
  });

  it("onayı ona düşmeyen kişi onaylayamaz", async () => {
    const { calisan, genelMudur, akran } = await sirket();
    const activity = await yaz(calisan);

    for (const kisi of [genelMudur, akran, calisan]) {
      const sonuc = await approveActivity(testDb, kisi.id, activity.id, NOW);
      expect(sonuc.ok).toBe(false);
      if (sonuc.ok) return;
      // Kaydın varlığı da ele verilmez.
      expect(sonuc.error).toBe("not_found");
    }

    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("ikinci onay reddedilir", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    await approveActivity(testDb, mudur.id, activity.id, NOW);
    const ikinci = await approveActivity(testDb, mudur.id, activity.id, NOW);

    expect(ikinci.ok).toBe(false);
    if (ikinci.ok) return;
    expect(ikinci.error).toBe("wrong_status");
  });

  it("onay denetim izine ve yazana bildirime düşer", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    await approveActivity(testDb, mudur.id, activity.id, NOW);

    const kayit = await testDb.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.activityApproved },
    });
    expect(kayit).toHaveLength(1);
    expect(kayit[0].userId).toBe(mudur.id);

    const bildirim = await testDb.notificationQueue.findMany({
      where: { eventType: NOTIFICATION_EVENTS.activityApproved },
    });
    expect(bildirim).toHaveLength(1);
    expect(bildirim[0].userId).toBe(calisan.id);
  });
});

describe("düzeltme isteme ve yeniden gönderme", () => {
  it("gerekçesiyle düzeltme istenir", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    const gerekce = await createApprovalReason("CHANGES_REQUESTED", "Eksik bilgi");

    const sonuc = await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: gerekce.id, note: "Hangi kalıplar olduğunu yaz." },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("CHANGES_REQUESTED");
    expect(stored.approvalReasonId).toBe(gerekce.id);
    expect(stored.approvalReasonNote).toBe("Hangi kalıplar olduğunu yaz.");
  });

  it("kategori zorunludur", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    const sonuc = await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: "11111111-1111-4111-8111-111111111111", note: "Bir şeyler" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("reason_required");
  });

  it("açıklama isteğe bağlıdır", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");

    const sonuc = await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: gerekce.id },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalReasonNote).toBeNull();
  });

  it("başka türün gerekçesi kullanılamaz", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    // Ret gerekçesiyle düzeltme istenemez; veritabanı da bileşik yabancı
    // anahtarla engelliyor.
    const retGerekcesi = await createApprovalReason("REJECTED");

    const sonuc = await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: retGerekcesi.id },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
  });

  it("pasif gerekçe seçilemez", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    // İki gerekçe: türün son aktif gerekçesi pasifleştirilemez (veritabanı
    // değişmezi, bulgu 11). Katalog boşalırsa o karar hiç verilemez.
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");
    await createApprovalReason("CHANGES_REQUESTED");
    await testDb.approvalReason.update({
      where: { id: gerekce.id },
      data: { isActive: false },
    });

    const sonuc = await requestChanges(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: gerekce.id },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
  });

  it("yazan düzeltip kaydedince iş yeniden müdüre düşer", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Kalıp bakımı",
        description: "Üç numaralı kalıpta erken aşınma tespit edildi.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("PENDING_APPROVAL");
    expect(stored.approvalReasonId).toBeNull();
    expect(stored.approvalReasonNote).toBeNull();
  });

  it("düzeltme penceresi kuralı düzeltme istenmiş kayıtta işlemez", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce2 = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: gerekce2.id }, NOW);

    // 15 dakikalık pencere çoktan kapandı; yine de düzeltilebilmeli, aksi
    // hâlde müdürün talebi baştan uygulanamaz olurdu.
    const cokSonra = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Kalıp bakımı",
        description: "Gerekçeye göre düzeltildi.",
        targetDepartmentIds: [],
      },
      cokSonra,
    );

    expect(sonuc.ok).toBe(true);
  });

  it("müdür düzeltme istedikten günler sonra (geçmişe dönük sınırı aşsa da) tarih korunursa düzeltilebilir", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    // 1 günlük geçmişe dönük sınır ayarı var
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.retroactiveEntryDays,
        value: "1",
        description: "Geçmişe dönük giriş sınırı (gün)",
      },
    });

    // 4 gün sonra çalışan düzeltiyor (tarih aynı kalıyor)
    const dortGunSonra = new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000);
    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Kalıp bakımı - güncellendi",
        description: "Düzeltmeler tamamlandı.",
        targetDepartmentIds: [],
      },
      dortGunSonra,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.activity.title).toBe("Kalıp bakımı - güncellendi");
    expect(sonuc.activity.approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("düzeltme kaydedildiğinde müdürün okundu kaydı silinir ve müdür için tekrar okunmamış olur", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");

    // Müdür faaliyeti inceleyip okudu ve düzeltme istedi
    await testDb.readReceipt.create({
      data: { activityId: activity.id, userId: mudur.id },
    });
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    expect(
      await testDb.readReceipt.count({ where: { activityId: activity.id, userId: mudur.id } }),
    ).toBe(1);

    // Çalışan düzeltip yeniden onaya sunar
    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Düzeltilmiş faaliyet",
        description: "Açıklama yenilendi.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(sonuc.ok).toBe(true);

    // Müdürün okundu kaydı silinmiş olmalı ki müdürün ekranında "okunmamış" görünsün
    expect(
      await testDb.readReceipt.count({ where: { activityId: activity.id, userId: mudur.id } }),
    ).toBe(0);
  });

  it("onay bekleyen kayıt pencere içinde yazan tarafından düzeltilebilir (§8.2)", async () => {
    const { calisan } = await sirket();
    const activity = await yaz(calisan);

    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Gizlice değiştirildi",
        description: "Müdür bakarken içerik değişmemeli.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.activity.title).toBe("Gizlice değiştirildi");
    expect(sonuc.activity.approvalStatus).toBe("PENDING_APPROVAL");

    // Onay turu korunur: yeni bir karar turu ancak müdür düzeltme istediğinde
    // açılır. Bu düzenleme aynı onay işinin güncellenmesidir.
    expect(
      await testDb.approvalRound.count({ where: { activityId: activity.id } }),
    ).toBe(1);
  });

  it("onay bekleyen kayıtta pencere ayara göre kapanır", async () => {
    const { calisan } = await sirket();
    const activity = await yaz(calisan);

    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        ...girdi(),
        id: activity.id,
        title: "Geç düzeltme",
      },
      new Date(NOW.getTime() + 16 * 60_000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("window_closed");
  });

  it("onay bekleyen kaydı müdür okuduysa yazar düzeltemez", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    await markActivityAsRead(
      testDb,
      { id: mudur.id, isSystemAdmin: false },
      activity.id,
      3_000,
      new Date(NOW.getTime() + 2 * 60_000),
    );

    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        ...girdi(),
        id: activity.id,
        title: "Okunduktan sonra değişmemeli",
      },
      new Date(NOW.getTime() + 3 * 60_000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("already_read");
  });
});

describe("onay kutusu", () => {
  it("yalnız kendi önündeki işleri listeler", async () => {
    const { calisan, mudur, akran } = await sirket();
    const birinci = await yaz(calisan, "Birinci");
    await yaz(calisan, "İkinci");

    await approveActivity(testDb, mudur.id, birinci.id, NOW);

    const mudurunku = await listPendingApprovals(testDb, mudur.id);
    expect(mudurunku.map((i) => i.title)).toEqual(["İkinci"]);

    // Akranın kutusu boş: onay ona düşmüyor.
    expect(await listPendingApprovals(testDb, akran.id)).toEqual([]);
  });
});

describe("reddetme (ürün sahibi kararı, 19.08.2026)", () => {
  it("müdür gerekçesiyle reddeder, kayıt kapanır", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("REJECTED", "Mükerrer kayıt");

    const sonuc = await rejectActivity(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: gerekce.id, note: "Aynı iş dün de yazılmıştı." },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("REJECTED");
    expect(stored.approvalReasonId).toBe(gerekce.id);
    expect(stored.approvalReasonNote).toBe("Aynı iş dün de yazılmıştı.");
    // Karar kimin verdiği kayıtta durur.
    expect(stored.approverId).toBe(mudur.id);
  });

  it("reddedilen kayıt üst kademeye akmaz", async () => {
    const { calisan, mudur, genelMudur, baskan } = await sirket();
    const activity = await yaz(calisan, "Reddedilen iş");
    const gerekce = await createApprovalReason("REJECTED");

    await rejectActivity(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    const kayit = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });

    // Süzgecin bütün amacı bu: uygun bulunmayan içerik yukarı gitmez.
    for (const ust of [genelMudur, baskan]) {
      expect(
        await canViewActivity(testDb, { id: ust.id, isSystemAdmin: false }, kayit),
      ).toBe("none");
    }

    // Yazan ve kararı veren görmeye devam eder.
    expect(
      await canViewActivity(testDb, { id: calisan.id, isSystemAdmin: false }, kayit),
    ).toBe("full");
    expect(
      await canViewActivity(testDb, { id: mudur.id, isSystemAdmin: false }, kayit),
    ).toBe("full");
  });

  it("reddedilen kayıt düzenlenemez", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("REJECTED");
    await rejectActivity(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    const sonuc = await updateActivity(
      testDb,
      calisan.id,
      {
        id: activity.id,
        activityDate: "2026-08-18",
        title: "Yeniden deneme",
        description: "Reddedilen kaydı düzeltmeye çalışıyorum.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 60_000),
    );

    // Reddetme bir **son** durumdur; düzeltilebilseydi "düzeltme iste"den
    // farkı kalmazdı.
    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("rejected");
  });

  it("düzeltme istenmiş kayıt da reddedilebilir", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const duzeltme = await createApprovalReason("CHANGES_REQUESTED");
    await requestChanges(testDb, mudur.id, activity.id, { reasonId: duzeltme.id }, NOW);

    const ret = await createApprovalReason("REJECTED");
    const sonuc = await rejectActivity(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: ret.id },
      NOW,
    );

    // Yazan kaydı hiç düzeltmezse, bu çıkış olmadan kayıt sonsuza kadar
    // askıda kalırdı: ne kapanabilir ne yukarı akabilirdi.
    expect(sonuc.ok).toBe(true);
    const stored = await testDb.activity.findUniqueOrThrow({
      where: { id: activity.id },
    });
    expect(stored.approvalStatus).toBe("REJECTED");
    expect(stored.approvalReasonId).toBe(ret.id);
  });

  it("onaylayıcı olmayan reddedemez", async () => {
    const { calisan, genelMudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("REJECTED");

    const sonuc = await rejectActivity(
      testDb,
      genelMudur.id,
      activity.id,
      { reasonId: gerekce.id },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    // Kaydın varlığı da bildirilmez.
    expect(sonuc.error).toBe("not_found");
  });

  it("onaylanmış kayıt reddedilemez", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    await approveActivity(testDb, mudur.id, activity.id, NOW);
    const gerekce = await createApprovalReason("REJECTED");

    const sonuc = await rejectActivity(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: gerekce.id },
      NOW,
    );

    // Yayımlanmış kaydın yolu iptaldir, ret değil.
    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("wrong_status");
  });

  it("kategori zorunludur", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);

    const sonuc = await rejectActivity(
      testDb,
      mudur.id,
      activity.id,
      { reasonId: "11111111-1111-4111-8111-111111111111" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("reason_required");
  });

  it("yazana bildirim gider ve karar denetim izine yazılır", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("REJECTED");

    await rejectActivity(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    const bildirim = await testDb.notificationQueue.findFirst({
      where: {
        userId: calisan.id,
        eventType: NOTIFICATION_EVENTS.activityRejected,
      },
    });
    expect(bildirim).not.toBeNull();

    const iz = await testDb.auditLog.findFirst({
      where: { objectId: activity.id, action: AUDIT_ACTIONS.activityRejected },
    });
    expect(iz).not.toBeNull();
    // Kategori ize girer (raporlanan odur); serbest açıklama içeriktir, girmez.
    expect(JSON.stringify(iz?.detail)).toContain(gerekce.id);
  });

  it("reddedilen kayıt onay kutusundan düşer", async () => {
    const { calisan, mudur } = await sirket();
    const activity = await yaz(calisan);
    const gerekce = await createApprovalReason("REJECTED");

    expect((await listPendingApprovals(testDb, mudur.id)).length).toBe(1);

    await rejectActivity(testDb, mudur.id, activity.id, { reasonId: gerekce.id }, NOW);

    expect((await listPendingApprovals(testDb, mudur.id)).length).toBe(0);
  });
});
