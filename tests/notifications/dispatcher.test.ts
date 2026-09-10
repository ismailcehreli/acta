import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { RETRY_DELAYS_MS } from "@/server/notifications/schedule";
import { dispatchNotifications } from "@/worker/notifications/dispatcher";
import type { EmailMessage, EmailTransport } from "@/worker/notifications/transport";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Kuyruk işleyicisi (§12.3): transactional outbox, mükerrer koruması, artan
// aralıklı ≤5 deneme, kısa aralık birleştirme, günlük özet modu.

const NOW = new Date("2026-08-17T09:00:00.000Z");
const BASE = { now: NOW, baseUrl: "https://faaliyet.ornek.test" };

beforeEach(async () => {
  faaliyetler.clear();
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function sahteTasiyici(): EmailTransport & { gonderilen: EmailMessage[] } {
  const gonderilen: EmailMessage[] = [];
  return {
    name: "sahte",
    gonderilen,
    async send(message) {
      gonderilen.push(message);
    },
  };
}

function bozukTasiyici(hata = "SMTP erişilemiyor"): EmailTransport {
  return {
    name: "bozuk",
    async send() {
      throw new Error(hata);
    },
  };
}

// Bildirimler **gerçek** bir faaliyete bağlanır. Uydurma kimlik kullanmak
// artık mümkün değil: kuyruk satırı faaliyete yabancı anahtarla bağlı ve
// gönderim anında görünürlük o bağ üzerinden sorgulanıyor (bulgu 3).
const faaliyetler = new Map<string, string>();

async function kullanici(
  overrides: { notificationMode?: "INSTANT" | "DAILY_DIGEST" | "ACTION_ONLY" } = {},
) {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const user = await createUser(unit.id, { fullName: "Alıcı", ...overrides });
  // Kişi kendi kaydını her zaman görür; testin konusu görünürlük değil,
  // gönderim davranışı.
  const kayit = await createActivity(user, { approvalStatus: "APPROVED" });
  faaliyetler.set(user.id, kayit.id);
  return user;
}

async function kuyrugaYaz(
  userId: string,
  key: string,
  eventType: string = NOTIFICATION_EVENTS.questionAsked,
) {
  return enqueueNotification(testDb, {
    userId,
    eventType: eventType as never,
    payload: { activityId: faaliyetler.get(userId) },
    idempotencyKey: key,
    now: NOW,
  });
}

describe("mükerrer koruması (§12.3)", () => {
  it("aynı olay iki kez işlense de tek bildirim gider", async () => {
    const user = await kullanici();

    const ilk = await kuyrugaYaz(user.id, "question_asked:abc");
    const ikinci = await kuyrugaYaz(user.id, "question_asked:abc");

    expect(ilk).toBe(true);
    // İkinci yazım sessizce geçer ama çağırana `false` döner.
    expect(ikinci).toBe(false);
    expect(await testDb.notificationQueue.count()).toBe(1);

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen).toHaveLength(1);
  });

  it("farklı nesneler ayrı bildirimdir", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");
    await kuyrugaYaz(user.id, "question_asked:def");

    expect(await testDb.notificationQueue.count()).toBe(2);
  });
});

describe("gönderim ve birleştirme", () => {
  it("gönderilen kayıt SENT olur ve zamanı yazılır", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");

    const sonuc = await dispatchNotifications(testDb, sahteTasiyici(), BASE);

    expect(sonuc).toEqual({
      sent: 1,
      delivered: 1,
      failed: 0,
      givenUp: 0,
      cancelled: 0,
    });
    const kayit = await testDb.notificationQueue.findFirstOrThrow();
    expect(kayit.status).toBe("SENT");
    expect(kayit.sentAt).toEqual(NOW);
    expect(kayit.attemptCount).toBe(1);
  });

  it("aynı kişiye biriken bildirimler tek e-postada birleşir", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");
    await kuyrugaYaz(user.id, "answer_received:def", NOTIFICATION_EVENTS.answerReceived);
    await kuyrugaYaz(user.id, "activity_cancelled:ghi", NOTIFICATION_EVENTS.activityCancelled);

    const tasiyici = sahteTasiyici();
    const sonuc = await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen).toHaveLength(1);
    expect(sonuc.delivered).toBe(3);
    expect(tasiyici.gonderilen[0].subject).toContain("3 bildirim");
    // Her bildirim e-postada bir satır olarak yer alır.
    expect(tasiyici.gonderilen[0].text).toContain("cevap geldi");
    expect(tasiyici.gonderilen[0].text).toContain("iptal edildi");
  });

  it("farklı kişilere ayrı e-posta gider", async () => {
    const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const biri = await createUser(unit.id, { fullName: "Biri" });
    const digeri = await createUser(unit.id, { fullName: "Diğeri" });
    await kuyrugaYaz(biri.id, "question_asked:abc");
    await kuyrugaYaz(digeri.id, "question_asked:def");

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen).toHaveLength(2);
    expect(new Set(tasiyici.gonderilen.map((m) => m.to)).size).toBe(2);
  });

  it("e-postada faaliyetin içeriği taşınmaz, sisteme çağırır", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen[0].text).toContain(BASE.baseUrl);
  });

  it("gönderilmiş kayıt ikinci turda tekrar gönderilmez", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, BASE);
    await dispatchNotifications(testDb, tasiyici, {
      ...BASE,
      now: new Date(NOW.getTime() + 3_600_000),
    });

    expect(tasiyici.gonderilen).toHaveLength(1);
  });
});

describe("yeniden deneme ve vazgeçme", () => {
  it("hata alan bildirim beklemede kalır, sebep kayda geçer", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");

    const sonuc = await dispatchNotifications(testDb, bozukTasiyici(), BASE);

    expect(sonuc.failed).toBe(1);
    const kayit = await testDb.notificationQueue.findFirstOrThrow();
    expect(kayit.status).toBe("PENDING");
    expect(kayit.attemptCount).toBe(1);
    expect(kayit.lastError).toContain("SMTP erişilemiyor");
  });

  it("bekleme süresi dolmadan yeniden denenmez", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");
    await dispatchNotifications(testDb, bozukTasiyici(), BASE);

    const tasiyici = sahteTasiyici();
    // İlk denemeden hemen sonra: sıra gelmedi.
    await dispatchNotifications(testDb, tasiyici, {
      ...BASE,
      now: new Date(NOW.getTime() + RETRY_DELAYS_MS[0] - 1),
    });
    expect(tasiyici.gonderilen).toHaveLength(0);

    // Süre dolunca denenir ve bu kez başarılı olur.
    await dispatchNotifications(testDb, tasiyici, {
      ...BASE,
      now: new Date(NOW.getTime() + RETRY_DELAYS_MS[0]),
    });
    expect(tasiyici.gonderilen).toHaveLength(1);
  });

  it("beş başarısız denemeden sonra FAILED olur ve bir daha denenmez", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");

    let an = NOW;
    for (let deneme = 0; deneme < 5; deneme += 1) {
      await dispatchNotifications(testDb, bozukTasiyici(), { ...BASE, now: an });
      an = new Date(an.getTime() + (RETRY_DELAYS_MS[deneme] ?? 0));
    }

    let kayit = await testDb.notificationQueue.findFirstOrThrow();
    expect(kayit.attemptCount).toBe(5);
    expect(kayit.status).toBe("PENDING");

    // Sonraki tur vazgeçer: kayıt beklemede kalmaz, operasyonda görünür.
    const tasiyici = sahteTasiyici();
    const sonuc = await dispatchNotifications(testDb, tasiyici, { ...BASE, now: an });

    expect(sonuc.givenUp).toBe(1);
    expect(tasiyici.gonderilen).toHaveLength(0);
    kayit = await testDb.notificationQueue.findFirstOrThrow();
    expect(kayit.status).toBe("FAILED");
    expect(kayit.lastError).toContain("SMTP erişilemiyor");
  });

  it("pasifleştirilmiş alıcıya gönderilmez, kayıt beklemede kalmaz", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "question_asked:abc");
    await testDb.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    const tasiyici = sahteTasiyici();
    const sonuc = await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen).toHaveLength(0);
    expect(sonuc.givenUp).toBe(1);
    const kayit = await testDb.notificationQueue.findFirstOrThrow();
    expect(kayit.status).toBe("FAILED");
    expect(kayit.lastError).toContain("pasif");
  });
});

describe("günlük özet modu (§12.3)", () => {
  const ozetSaati = new Date("2026-08-17T15:00:00.000Z"); // 18:00 İstanbul

  it("özet saatinden önce e-posta gitmez", async () => {
    const user = await kullanici({ notificationMode: "DAILY_DIGEST" });
    await kuyrugaYaz(user.id, "question_asked:abc");

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen).toHaveLength(0);
    // Kayıt kaybolmaz, beklemede kalır.
    const kayit = await testDb.notificationQueue.findFirstOrThrow();
    expect(kayit.status).toBe("PENDING");
    expect(kayit.attemptCount).toBe(0);
  });

  it("özet saatinde günün tamamı tek e-postada gider", async () => {
    const user = await kullanici({ notificationMode: "DAILY_DIGEST" });
    await kuyrugaYaz(user.id, "question_asked:abc");
    await kuyrugaYaz(user.id, "answer_received:def", NOTIFICATION_EVENTS.answerReceived);

    const tasiyici = sahteTasiyici();
    const sonuc = await dispatchNotifications(testDb, tasiyici, {
      ...BASE,
      now: ozetSaati,
    });

    expect(tasiyici.gonderilen).toHaveLength(1);
    expect(sonuc.delivered).toBe(2);
    expect(tasiyici.gonderilen[0].subject).toContain("günlük özet");
  });

  it("aynı gün ikinci özet gitmez, ertesi gün gider", async () => {
    const user = await kullanici({ notificationMode: "DAILY_DIGEST" });
    await kuyrugaYaz(user.id, "question_asked:abc");

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, { ...BASE, now: ozetSaati });
    expect(tasiyici.gonderilen).toHaveLength(1);

    // Aynı gün yeni bir olay: özet zaten gitti, beklemeye alınır.
    await kuyrugaYaz(user.id, "answer_received:def", NOTIFICATION_EVENTS.answerReceived);
    await dispatchNotifications(testDb, tasiyici, {
      ...BASE,
      now: new Date("2026-08-17T19:00:00.000Z"),
    });
    expect(tasiyici.gonderilen).toHaveLength(1);

    // Ertesi günün özet saatinde gider.
    await dispatchNotifications(testDb, tasiyici, {
      ...BASE,
      now: new Date("2026-08-18T15:00:00.000Z"),
    });
    expect(tasiyici.gonderilen).toHaveLength(2);
  });

  it("özet modunda olmayan kullanıcı beklemez", async () => {
    const user = await kullanici({ notificationMode: "INSTANT" });
    await kuyrugaYaz(user.id, "question_asked:abc");

    const tasiyici = sahteTasiyici();
    await dispatchNotifications(testDb, tasiyici, BASE);

    expect(tasiyici.gonderilen).toHaveLength(1);
  });
});

describe("bildirim tercihi (Görev 10.8)", () => {
  it("'yalnız işlem isteyenler' modunda bilgilendirme gönderilmez", async () => {
    const user = await kullanici({ notificationMode: "ACTION_ONLY" });
    // "Onaylandı" bir bilgilendirmedir: okuduktan sonra yapılacak bir şey yok.
    await kuyrugaYaz(user.id, "bilgi:1", NOTIFICATION_EVENTS.activityApproved);

    const transport = sahteTasiyici();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(transport.gonderilen).toHaveLength(0);

    // Kuyrukta **bekletilmiyor**: aksi hâlde kuyruk hiç gönderilmeyecek
    // kayıtlarla dolar ve gecikme ölçümü bozulurdu.
    const kayit = await testDb.notificationQueue.findFirstOrThrow({
      where: { userId: user.id, idempotencyKey: "bilgi:1" },
    });
    expect(kayit.status).toBe("SENT");
    expect(kayit.lastError).toContain("tercihi");
  });

  it("'yalnız işlem isteyenler' modunda iş isteyen bildirim gider", async () => {
    const user = await kullanici({ notificationMode: "ACTION_ONLY" });
    await kuyrugaYaz(user.id, "is:1", NOTIFICATION_EVENTS.questionAsked);

    const transport = sahteTasiyici();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(transport.gonderilen).toHaveLength(1);
  });

  it("tercih ne olursa olsun acil bildirim gider", async () => {
    const user = await kullanici({ notificationMode: "ACTION_ONLY" });
    await kuyrugaYaz(user.id, "acil:1", NOTIFICATION_EVENTS.passwordReset);

    const transport = sahteTasiyici();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    // Parola sıfırlama bağlantısının bir tercih yüzünden hiç gitmemesi,
    // kullanıcıyı sistemden kilitlerdi.
    expect(transport.gonderilen).toHaveLength(1);
  });

  it("yeni hesap bağlantısı günlük özeti beklemez", async () => {
    const user = await kullanici({ notificationMode: "DAILY_DIGEST" });
    await kuyrugaYaz(user.id, "hesap:1", NOTIFICATION_EVENTS.accountCreated);

    const transport = sahteTasiyici();
    await dispatchNotifications(testDb, transport, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(transport.gonderilen).toHaveLength(1);
    expect(transport.gonderilen[0]?.text).toContain("hesabınız açıldı");
  });
});

// GÖRÜNÜRLÜK GÖNDERİM ANINDA SORULUR (denetim 21.08.2026, bulgu 3).
//
// Bulgunun en keskin kısmı buydu: kutuda bir satır **göstermek** ile kişiye
// faaliyetin başlığını taşıyan bir e-posta **yollamak** aynı şey değil.
// İkincisi, görünürlük katmanının hiç bilmediği bir yerden yeni bir ifşadır.
describe("alıcı kaydı göremez hâle gelmişse gönderilmez", () => {
  it("başlık taşıyan e-posta gitmez, kayıt CANCELLED olur", async () => {
    const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const alici = await createUser(unit.id, { fullName: "Alıcı" });
    const baskasi = await createUser(unit.id, { fullName: "Başkası" });

    // Alıcının göremediği bir kayıt: akranının kaydı (§8.1).
    const kayit = await createActivity(baskasi, {
      approvalStatus: "APPROVED",
      title: "Gizli başlık",
    });

    await enqueueNotification(testDb, {
      userId: alici.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: kayit.id, activityTitle: kayit.title },
      idempotencyKey: "sizinti:posta",
      now: NOW,
    });

    const tasiyici = sahteTasiyici();
    const sonuc = await dispatchNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    expect(sonuc.sent).toBe(0);
    expect(sonuc.cancelled).toBe(1);
    expect(tasiyici.gonderilen).toHaveLength(0);

    const satir = await testDb.notificationQueue.findFirstOrThrow({
      where: { userId: alici.id },
    });
    // `FAILED` değil: ortada arıza yok, gönderilmemesi doğru karar.
    expect(satir.status).toBe("CANCELLED");
  });

  it("görebildiği kaydın bildirimi normal gider", async () => {
    const user = await kullanici();
    await kuyrugaYaz(user.id, "gorunur:posta");

    const tasiyici = sahteTasiyici();
    const sonuc = await dispatchNotifications(testDb, tasiyici, {
      now: NOW,
      baseUrl: "https://ornek.test",
    });

    // Kontrol testi: yukarıdaki engelin sebebi görünürlük olmalı.
    expect(sonuc.sent).toBe(1);
    expect(sonuc.cancelled).toBe(0);
  });
});
