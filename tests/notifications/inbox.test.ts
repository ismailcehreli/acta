import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueueNotification } from "@/server/notifications/enqueue";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import {
  countUnseen,
  listInbox,
  markInboxSeen,
  relativeTime,
} from "@/server/notifications/inbox";
import { saveSubscription } from "@/server/push/subscriptions";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Uygulama içi bildirim kutusu (Görev 10.4).
//
// Kutu, bildirim kuyruğunu okuyor. İki şey kritik: kimse **başkasının**
// bildirimini görmemeli ve bir olay zilde **iki kez** çıkmamalı (push ve
// e-posta için ayrı kuyruk satırı yazılabiliyor).

const NOW = new Date("2026-08-19T12:00:00.000Z");

beforeEach(async () => {
  faaliyetler.clear();
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

// Bildirim gerçek bir faaliyete bağlanır: kuyruk satırı artık faaliyete
// yabancı anahtarla bağlı ve kutu, görünürlüğü o bağ üzerinden süzüyor
// (bulgu 3). Kişi kendi kaydını her zaman görür.
const faaliyetler = new Map<string, string>();

async function ikiKisi() {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const birinci = await createUser(unit.id, { fullName: "Birinci" });
  const ikinci = await createUser(unit.id, { fullName: "İkinci" });

  for (const kisi of [birinci, ikinci]) {
    const kayit = await createActivity(kisi, { approvalStatus: "APPROVED" });
    faaliyetler.set(kisi.id, kayit.id);
  }

  return { birinci, ikinci };
}

async function haberVer(
  userId: string,
  anahtar: string,
  baslik = "Kalıp bakımı",
  eventType: string = NOTIFICATION_EVENTS.questionAsked,
) {
  await enqueueNotification(testDb, {
    userId,
    eventType: eventType as typeof NOTIFICATION_EVENTS.questionAsked,
    payload: { activityId: faaliyetler.get(userId), activityTitle: baslik },
    idempotencyKey: anahtar,
    now: NOW,
  });
}

describe("kutu kime ait", () => {
  it("kişi yalnız kendi bildirimlerini görür", async () => {
    const { birinci, ikinci } = await ikiKisi();
    await haberVer(birinci.id, "a:1", "Birincinin işi");
    await haberVer(ikinci.id, "a:2", "İkincinin işi");

    const kutu = await listInbox(testDb, birinci.id);

    expect(kutu).toHaveLength(1);
    expect(kutu[0]?.summary).not.toContain("İkincinin işi");
  });

  it("görülmemiş sayısı kişiye özeldir", async () => {
    const { birinci, ikinci } = await ikiKisi();
    await haberVer(birinci.id, "a:1");
    await haberVer(ikinci.id, "a:2");
    await haberVer(ikinci.id, "a:3");

    expect(await countUnseen(testDb, birinci.id)).toBe(1);
    expect(await countUnseen(testDb, ikinci.id)).toBe(2);
  });

  it("görüldü işareti başkasının kutusunu boşaltmaz", async () => {
    const { birinci, ikinci } = await ikiKisi();
    await haberVer(birinci.id, "a:1");
    await haberVer(ikinci.id, "a:2");

    await markInboxSeen(testDb, birinci.id, NOW);

    expect(await countUnseen(testDb, birinci.id)).toBe(0);
    // Başkasının zilini sessizce boşaltan bir uç olmamalı.
    expect(await countUnseen(testDb, ikinci.id)).toBe(1);
  });
});

describe("mükerrer gösterim", () => {
  it("aynı olay push ile birlikte yazılsa da zilde bir kez çıkar", async () => {
    const { birinci } = await ikiKisi();
    // Aboneliği olan kişiye hem e-posta hem push satırı yazılır.
    await saveSubscription(
      testDb,
      birinci.id,
      {
        endpoint: "https://push.ornek.test/abone-1",
        p256dh: "BExampleKeyMaterial",
        auth: "ExampleAuthSecret",
      },
      NOW,
    );

    await haberVer(birinci.id, "a:1");

    expect(await testDb.notificationQueue.count({ where: { userId: birinci.id } })).toBe(2);
    // Zil kanonik satırı (e-posta) okuyor.
    expect(await listInbox(testDb, birinci.id)).toHaveLength(1);
    expect(await countUnseen(testDb, birinci.id)).toBe(1);
  });

  it("her bildirim tam olarak bir e-posta satırı yazar", async () => {
    // Zilin doğruluğu bu değişmeze dayanıyor: bir olayın kanonik satırı
    // e-postadır. İleride bir olay için e-posta yazılmazsa zil onu sessizce
    // kaçırır; bu test o değişmezi sabitliyor.
    const { birinci } = await ikiKisi();

    for (const [i, olay] of Object.values(NOTIFICATION_EVENTS).entries()) {
      await haberVer(birinci.id, `olay:${i}`, "Kayıt", olay);
    }

    const eposta = await testDb.notificationQueue.count({
      where: { userId: birinci.id, channel: "EMAIL" },
    });
    expect(eposta).toBe(Object.values(NOTIFICATION_EVENTS).length);
  });
});

describe("sıralama ve içerik", () => {
  it("yeniden eskiye sıralanır", async () => {
    const { birinci } = await ikiKisi();
    await testDb.notificationQueue.createMany({
      data: [
        {
          // Başlığı metne koyan bir olay seçildi; "soru soruldu" şablonu
          // başlık taşımıyor ve sıralama sınanamazdı.
          userId: birinci.id,
          eventType: NOTIFICATION_EVENTS.activityApproved,
          channel: "EMAIL",
          payload: { activityTitle: "Eski" },
          idempotencyKey: "e:1",
          createdAt: new Date("2026-08-18T09:00:00.000Z"),
        },
        {
          userId: birinci.id,
          eventType: NOTIFICATION_EVENTS.activityApproved,
          channel: "EMAIL",
          payload: { activityTitle: "Yeni" },
          idempotencyKey: "e:2",
          createdAt: new Date("2026-08-19T09:00:00.000Z"),
        },
      ],
    });

    const kutu = await listInbox(testDb, birinci.id);

    expect(kutu[0]?.summary).toContain("Yeni");
    expect(kutu[1]?.summary).toContain("Eski");
  });

  it("satır metni bildirim şablonundan gelir", async () => {
    const { birinci } = await ikiKisi();
    await haberVer(birinci.id, "a:1", "Kalıp bakımı", NOTIFICATION_EVENTS.activityApproved);

    const kutu = await listInbox(testDb, birinci.id);

    expect(kutu[0]?.summary).toContain("Kalıp bakımı");
    expect(kutu[0]?.path).toContain("/activities/");
  });

  it("liste sınırı aşılmaz", async () => {
    const { birinci } = await ikiKisi();
    for (let i = 0; i < 20; i += 1) await haberVer(birinci.id, `a:${i}`);

    expect(await listInbox(testDb, birinci.id, 5)).toHaveLength(5);
  });
});

describe("göreli zaman", () => {
  it("bir dakikanın altı 'az önce'", () => {
    expect(relativeTime(new Date("2026-08-19T11:59:30.000Z"), NOW)).toBe("az önce");
  });

  it("saat altı dakika", () => {
    expect(relativeTime(new Date("2026-08-19T11:20:00.000Z"), NOW)).toBe("40 dk önce");
  });

  it("gün altı saat", () => {
    expect(relativeTime(new Date("2026-08-19T09:00:00.000Z"), NOW)).toBe("3 sa önce");
  });

  // Bir günden eskisi tarihe düşer. Biçim Görev 11.1'de "15.08" yerine
  // "15 Ağu 12:00" oldu: eski biçim yılsızdı ve geçen yılın bildirimi bu
  // yılınki gibi görünüyordu; ay adı da iki haneli sayıdan hızlı okunuyor.
  it("daha eskisi tarih ve saat", () => {
    // 09:00 UTC = 12:00 İstanbul.
    expect(relativeTime(new Date("2026-08-15T09:00:00.000Z"), NOW)).toBe(
      "15 Ağu 12:00",
    );
  });
});

// Zil kutusunda faaliyet numarası (21.08.2026).
//
// Numarasız kutuda "bir faaliyetiniz hakkında soru soruldu" satırı üst üste
// üç kez çıkabiliyordu ve kullanıcı hangi kayıt olduğunu anlayamıyordu.
// Numara **yalnız zil kutusunda** eklenir; e-posta ve tarayıcı bildiriminin
// metni değişmez.
describe("faaliyet numarası", () => {
  it("bildirim gerçek bir kayda işaret ediyorsa numarası gelir", async () => {
    // Ağaçta tek kök olabilir; `ikiKisi` zaten kökü kurdu.
    const { birinci } = await ikiKisi();
    const kayit = await createActivity(birinci, { approvalStatus: "APPROVED" });

    await enqueueNotification(testDb, {
      userId: birinci.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: kayit.id, activityTitle: kayit.title },
      idempotencyKey: "numara:1",
      now: NOW,
    });

    const kutu = await listInbox(testDb, birinci.id);
    expect(kutu.map((satir) => satir.activityNo)).toContain(kayit.activityNo);
  });

  it("faaliyete bağlı olmayan bildirim numarasız çizilir", async () => {
    const { birinci } = await ikiKisi();

    // Parola sıfırlama gibi olayların faaliyeti yoktur; görünürlük sorusu da
    // doğmaz, kutuda koşulsuz görünürler.
    await enqueueNotification(testDb, {
      userId: birinci.id,
      eventType: NOTIFICATION_EVENTS.passwordReset,
      payload: { link: "https://ornek.test/reset/abc" },
      idempotencyKey: "numara:2",
      now: NOW,
    });

    const kutu = await listInbox(testDb, birinci.id);
    const satir = kutu.find((s) => s.eventType === NOTIFICATION_EVENTS.passwordReset);
    expect(satir).toBeDefined();
    expect(satir?.activityNo).toBeNull();
    expect(satir?.summary).not.toBe("");
  });
});

// GÖRÜNÜRLÜK KUTUDA DA GEÇERLİ (denetim 21.08.2026, bulgu 3).
//
// Bildirim **olduğu anda** doğru olan bir haberdir; okunduğu anda hâlâ doğru
// olmayabilir. Kişi başka dala taşınmış, vekâleti bitmiş ya da kararı başkası
// vermiş olabilir. O andan sonra kaydın başlığını ve numarasını göstermek,
// görünürlük katmanını atlayan bir okuma yoludur (§8, §18.4).
describe("göremediği kaydın bildirimi kutuda görünmez", () => {
  it("akranın kaydına ait bildirim listelenmez ve sayılmaz", async () => {
    const { birinci, ikinci } = await ikiKisi();
    const baskasininKaydi = await createActivity(ikinci, {
      approvalStatus: "APPROVED",
    });

    await enqueueNotification(testDb, {
      userId: birinci.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: {
        activityId: baskasininKaydi.id,
        activityTitle: baskasininKaydi.title,
      },
      idempotencyKey: "sizinti:1",
      now: NOW,
    });

    // Satır kuyrukta duruyor ama kutuya çıkmıyor.
    expect(
      await testDb.notificationQueue.count({
        where: { userId: birinci.id, activityId: baskasininKaydi.id },
      }),
    ).toBe(1);

    const kutu = await listInbox(testDb, birinci.id);
    expect(kutu.map((satir) => satir.summary).join(" ")).not.toContain(
      baskasininKaydi.title,
    );

    // Sayaç da sızdırmamalı: varlığı sayıdan öğrenmek de sızıntıdır.
    expect(await countUnseen(testDb, birinci.id)).toBe(0);
  });

  it("kendi kaydına ait bildirim görünür", async () => {
    const { birinci } = await ikiKisi();
    const kendiKaydi = await createActivity(birinci, { approvalStatus: "APPROVED" });

    await enqueueNotification(testDb, {
      userId: birinci.id,
      eventType: NOTIFICATION_EVENTS.questionAsked,
      payload: { activityId: kendiKaydi.id, activityTitle: kendiKaydi.title },
      idempotencyKey: "gorunur:1",
      now: NOW,
    });

    // Kontrol testi: yukarıdaki boşluğun sebebi görünürlük olmalı,
    // "kutu hiç çalışmıyor" değil.
    expect(await countUnseen(testDb, birinci.id)).toBe(1);
  });
});
