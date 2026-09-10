import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listActivityConversations, listOpenWorkItems } from "@/server/conversations/read";
import {
  askQuestion,
  canAskQuestion,
  closeConversation,
  replyToConversation,
} from "@/server/conversations/service";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { conversationMessageSchema } from "@/shared/schemas/conversation";

import { resetDatabase, testDb } from "../helpers/test-db";

// §9: faaliyet başına bağımsız konuşmalar, tek sorumlu, cevapla el değiştiren
// sorumluluk, ara kademelerin görmesi, tur sınırının olmaması.

const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function buildScenario() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const directorate = await createOrgUnit({ name: "Direktörlük", parentId: root.id });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: directorate.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: directorate.id });

  const generalManager = await createUser(root.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const director = await createUser(directorate.id, {
    fullName: "Direktör",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const peer = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const sysAdmin = await createUser(root.id, {
    fullName: "Sistem Yöneticisi",
    isSystemAdmin: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Kalıp bakımı",
      description: "Çatlak onarıldı.",
      approvalStatus: "APPROVED",
    },
  });

  return {
    generalManager,
    director,
    author,
    peer,
    sysAdmin,
    activity,
    units: { root, directorate, moldShop, planning },
  };
}

const actor = (user: { id: string; isSystemAdmin: boolean }) => ({
  id: user.id,
  isSystemAdmin: user.isSystemAdmin,
});

describe("soru sorma yetkisi (§9.2)", () => {
  it("üst zincirdeki yönetici soru sorabilir", async () => {
    const { director, activity } = await buildScenario();

    expect(
      await canAskQuestion(testDb, actor(director), activity),
    ).toBe(true);
  });

  it("yazan kendi faaliyetine soru açamaz", async () => {
    const { author, activity } = await buildScenario();

    expect(await canAskQuestion(testDb, actor(author), activity)).toBe(false);
  });

  it("akran soru soramaz; faaliyeti göremiyor bile", async () => {
    const { peer, activity } = await buildScenario();

    expect(await canAskQuestion(testDb, actor(peer), activity)).toBe(false);

    const sonuc = await askQuestion(
      testDb,
      actor(peer),
      { activityId: activity.id, text: "Bu ne demek?" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    // Göremediği faaliyetin varlığı da bildirilmez.
    expect(sonuc.message).toBe("Faaliyet bulunamadı.");
  });

  it("sistem yöneticisi ağaçta üstte değilse soru soramaz", async () => {
    const { sysAdmin, activity } = await buildScenario();

    const sonuc = await askQuestion(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      { activityId: activity.id, text: "Bu ne demek?" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
  });
});

describe("akış (§9.2)", () => {
  it("soru açılınca sorumlu faaliyeti yazan kişidir", async () => {
    const { director, author, activity } = await buildScenario();

    const sonuc = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Bu kalıp sorunu neden sürüyor?" },
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value.askerId).toBe(director.id);
    expect(sonuc.value.responsibleId).toBe(author.id);
    expect(sonuc.value.status).toBe("OPEN");
  });

  it("soru sorulunca yazana bildirim kuyruğa yazılır (§12.2)", async () => {
    const { director, author, activity } = await buildScenario();

    await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru metni" },
      NOW,
    );

    const bildirimler = await testDb.notificationQueue.findMany();
    expect(bildirimler).toHaveLength(1);
    expect(bildirimler[0].userId).toBe(author.id);
    expect(bildirimler[0].eventType).toBe("question_asked");
  });

  it("cevap verilince sorumluluk soruyu sorana geçer", async () => {
    const { director, author, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    const cevap = await replyToConversation(
      testDb,
      actor(author),
      { conversationId: acilis.value.id, text: "Yedek parça bekleniyor." },
      new Date(NOW.getTime() + 60_000),
    );

    expect(cevap.ok).toBe(true);
    if (!cevap.ok) return;
    expect(cevap.value.responsibleId).toBe(director.id);
  });

  it("cevap gelince sorana bildirim yazılır", async () => {
    const { director, author, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: acilis.value.id, text: "Cevap" },
      new Date(NOW.getTime() + 60_000),
    );

    const bildirimler = await testDb.notificationQueue.findMany({
      where: { eventType: "answer_received" },
    });
    expect(bildirimler).toHaveLength(1);
    expect(bildirimler[0].userId).toBe(director.id);
  });

  it("tur sınırı yoktur; sorumluluk her mesajda el değiştirir (§9.4)", async () => {
    const { director, author, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru 1" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    let zaman = NOW.getTime();
    for (let tur = 0; tur < 5; tur += 1) {
      zaman += 60_000;
      const cevap = await replyToConversation(
        testDb,
        actor(author),
        { conversationId: acilis.value.id, text: `Cevap ${tur}` },
        new Date(zaman),
      );
      expect(cevap.ok).toBe(true);
      if (cevap.ok) expect(cevap.value.responsibleId).toBe(director.id);

      zaman += 60_000;
      const yeniSoru = await replyToConversation(
        testDb,
        actor(director),
        { conversationId: acilis.value.id, text: `Ek soru ${tur}` },
        new Date(zaman),
      );
      expect(yeniSoru.ok).toBe(true);
      if (yeniSoru.ok) expect(yeniSoru.value.responsibleId).toBe(author.id);
    }

    const mesajlar = await testDb.conversationMessage.count({
      where: { conversationId: acilis.value.id },
    });
    expect(mesajlar).toBe(11);
  });

  it("faaliyet başına birden fazla bağımsız konuşma olabilir (§9.1)", async () => {
    const { director, generalManager, author, activity } = await buildScenario();

    const ilk = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Direktörün sorusu" },
      NOW,
    );
    const ikinci = await askQuestion(
      testDb,
      actor(generalManager),
      { activityId: activity.id, text: "Genel Müdürün sorusu" },
      NOW,
    );

    expect(ilk.ok && ikinci.ok).toBe(true);
    if (!ilk.ok || !ikinci.ok) return;

    // Birine verilen cevap diğerini ilerletmez.
    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: ilk.value.id, text: "Cevap" },
      new Date(NOW.getTime() + 60_000),
    );

    const ikinciGuncel = await testDb.conversation.findUniqueOrThrow({
      where: { id: ikinci.value.id },
    });
    expect(ikinciGuncel.responsibleId).toBe(author.id);
  });

  it("konuşmanın tarafı olmayan kişi mesaj yazamaz", async () => {
    const { director, peer, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    const sonuc = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: acilis.value.id, text: "Araya girdim" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    // Taraf olmayan kişi, var olmayan konuşmayla aynı cevabı alır.
    expect(sonuc.error).toBe("conversation_not_found");
  });
});

describe("kapatma (§9.3) — veritabanına karşı", () => {
  async function acilmisKonusma() {
    const scenario = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(scenario.director),
      { activityId: scenario.activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");
    return { ...scenario, conversation: acilis.value };
  }

  it("soran kapatabilir", async () => {
    const { director, conversation } = await acilmisKonusma();

    const sonuc = await closeConversation(
      testDb,
      actor(director),
      conversation.id,
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value.closeType).toBe("NORMAL");
  });

  it("sorumlu kapatamaz — cevap verdikten sonra bile", async () => {
    const { author, conversation } = await acilmisKonusma();
    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: conversation.id, text: "Cevap" },
      new Date(NOW.getTime() + 60_000),
    );

    const sonuc = await closeConversation(
      testDb,
      actor(author),
      conversation.id,
      new Date(NOW.getTime() + 120_000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("responsible_cannot_close");
  });

  it("soranın üstü 10 iş günü dolmadan kapatamaz", async () => {
    const { generalManager, conversation } = await acilmisKonusma();

    const sonuc = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-08-20T09:00:00.000Z"),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("supervisor_too_early");
  });

  it("soranın üstü 10 iş günü sonra kapatabilir", async () => {
    const { generalManager, conversation } = await acilmisKonusma();

    const sonuc = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-09-01T09:00:00.000Z"),
    );

    expect(sonuc.ok).toBe(true);
  });

  // Denetim (18.08.2026, bulgu 6): iş günü sayacı saf fonksiyonda
  // tatil listesi kabul ediyordu ama üretim yolu listeyi hiç doldurmuyordu.
  // Birim testi elle tatil vererek yeşil oluyordu; kanıt gerçek servisten
  // gelmeli.
  //
  // 17 Ağustos 2026 Pazartesi açılan konuşmada 10. iş günü 31 Ağustos'tur.
  it("resmî tatil sayacı geciktirir — gerçek servis üzerinden", async () => {
    const { generalManager, conversation } = await acilmisKonusma();
    const onuncuIsGunu = new Date("2026-08-31T09:00:00.000Z");

    // Tatil yokken 10 iş günü dolmuştur.
    const tatilsiz = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      onuncuIsGunu,
    );
    expect(tatilsiz.ok).toBe(true);
  });

  it("tatil ilan edilince üst aynı gün kapatamaz", async () => {
    const { generalManager, conversation } = await acilmisKonusma();
    await testDb.holiday.create({
      data: { date: new Date("2026-08-31T00:00:00.000Z"), description: "Deneme tatili" },
    });

    const sonuc = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-08-31T09:00:00.000Z"),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("supervisor_too_early");
  });

  // Aynı bulgunun ikinci yarısı: sayaç, soranın **son** hareketinden işler.
  // Servis son 50 mesajı çekip içinde soranınkini arıyordu; uzun konuşmada
  // soranın mesajı pencerenin dışında kalınca sayaç açılış tarihine dönüyor ve
  // üst hak ettiğinden erken kapatabiliyordu.
  it("uzun konuşmada soranın son hareketi kaybolmaz", async () => {
    const { director, author, generalManager, conversation } = await acilmisKonusma();

    // Soran, açılıştan bir hafta sonra yeniden yazıyor.
    const soraninSonHareketi = new Date("2026-08-24T09:00:00.000Z");
    await testDb.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: director.id,
        text: "Hatırlatma",
        createdAt: soraninSonHareketi,
      },
    });

    // Ardından 60 cevap: soranın mesajı son 50'nin dışında kalıyor.
    await testDb.conversationMessage.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        conversationId: conversation.id,
        authorId: author.id,
        text: `Ara cevap ${i + 1}`,
        createdAt: new Date(soraninSonHareketi.getTime() + (i + 1) * 60_000),
      })),
    });

    // Soranın son hareketinden (24 Ağustos) 31 Ağustos'a 5 iş günü var.
    const sonuc = await closeConversation(
      testDb,
      actor(generalManager),
      conversation.id,
      new Date("2026-08-31T09:00:00.000Z"),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("supervisor_too_early");
  });

  it("sistem yöneticisi idari olarak kapatır; gerekçe kayda geçer", async () => {
    const { sysAdmin, conversation } = await acilmisKonusma();

    const sonuc = await closeConversation(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      conversation.id,
      NOW,
      "Soran kişi işten ayrıldı, hesabı kapatılacak.",
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value.closeType).toBe("ADMINISTRATIVE");
    expect(sonuc.value.closeReason).toBe(
      "Soran kişi işten ayrıldı, hesabı kapatılacak.",
    );
  });

  it("gerekçesiz idari kapatma reddedilir", async () => {
    const { sysAdmin, conversation } = await acilmisKonusma();

    for (const gerekce of [undefined, "", "   "]) {
      const sonuc = await closeConversation(
        testDb,
        { id: sysAdmin.id, isSystemAdmin: true },
        conversation.id,
        NOW,
        gerekce,
      );

      expect(sonuc.ok).toBe(false);
      if (sonuc.ok) return;
      expect(sonuc.error).toBe("reason_required");
    }

    // Konuşma açık kalmalı: reddedilen kapatma yan etki bırakmaz.
    const guncel = await testDb.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(guncel.status).toBe("OPEN");
    expect(guncel.closeReason).toBeNull();
  });

  it("soranın kendi kapatmasında gerekçe alanı boş kalır", async () => {
    const { director, conversation } = await acilmisKonusma();

    const sonuc = await closeConversation(
      testDb,
      actor(director),
      conversation.id,
      NOW,
      "yok sayılmalı",
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    // Gerekçe yalnız idari kapatmaya aittir; normal kapanışta saklanmaz.
    expect(sonuc.value.closeType).toBe("NORMAL");
    expect(sonuc.value.closeReason).toBeNull();
  });

  it("idari kapatma, pasifleştirmenin önünü açar (§4.6 kilidi)", async () => {
    const { sysAdmin, director, conversation } = await acilmisKonusma();

    // Açık konuşma varken pasifleştirme veritabanınca engelleniyor.
    await expect(
      testDb.user.update({
        where: { id: director.id },
        data: { isActive: false, isUnitManager: false },
      }),
    ).rejects.toThrow(/USER_HAS_OPEN_CONVERSATIONS/);

    await closeConversation(
      testDb,
      { id: sysAdmin.id, isSystemAdmin: true },
      conversation.id,
      NOW,
      "Kullanıcı işten ayrıldı.",
    );

    // Konuşma kapandıktan sonra pasifleştirme mümkün.
    const guncel = await testDb.user.update({
      where: { id: director.id },
      data: { isActive: false, isUnitManager: false },
    });
    expect(guncel.isActive).toBe(false);
  });

  // Denetim (18.08.2026, bulgu 13): mesajlara tasarımda olmayan üç
  // karakterlik alt sınır konmuştu; "Evet" değil ama "OK" bile reddediliyordu.
  it("tek karakterlik cevap geçerlidir, boş mesaj değildir", async () => {
    expect(conversationMessageSchema.safeParse("E").success).toBe(true);
    expect(conversationMessageSchema.safeParse("").success).toBe(false);
    expect(conversationMessageSchema.safeParse("   ").success).toBe(false);
  });

  it("kapalı konuşmaya mesaj yazılamaz", async () => {
    const { director, author, conversation } = await acilmisKonusma();
    await closeConversation(testDb, actor(director), conversation.id, NOW);

    const sonuc = await replyToConversation(
      testDb,
      actor(author),
      { conversationId: conversation.id, text: "Geç cevap" },
      new Date(NOW.getTime() + 60_000),
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("closed");
  });
});

// Denetim (18.08.2026, FAZ 4 bulgu 1): konuşma eylemleri faaliyetin
// güncel görünürlüğünü doğrulamıyordu. Konuşma kimliğini bilmek yetki değildir;
// kimlik zaten taraflara veriliyor.
describe("konuşma yolları görünürlükten geçer", () => {
  async function konusmaKur() {
    const context = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(context.director),
      { activityId: context.activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");
    return { ...context, conversation: acilis.value };
  }

  it("akran, kimliğini bilse de konuşmaya yazamaz", async () => {
    const { peer, conversation } = await konusmaKur();

    const sonuc = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: conversation.id, text: "Araya girdim" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    // Var olmayan konuşmayla aynı cevap: varlık ele verilmez.
    expect(sonuc.error).toBe("conversation_not_found");
  });

  it("yetkisiz ile var olmayan konuşma aynı cevabı alır", async () => {
    const { peer, conversation } = await konusmaKur();

    const yetkisiz = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: conversation.id, text: "Metin" },
      NOW,
    );
    const olmayan = await replyToConversation(
      testDb,
      actor(peer),
      {
        conversationId: "00000000-0000-0000-0000-000000000000",
        text: "Metin",
      },
      NOW,
    );

    expect(yetkisiz).toEqual(olmayan);
  });

  it("kapalı konuşmanın durumu yetkisiz kişiye açıklanmaz", async () => {
    const { director, peer, conversation } = await konusmaKur();
    await closeConversation(testDb, actor(director), conversation.id, NOW);

    const sonuc = await replyToConversation(
      testDb,
      actor(peer),
      { conversationId: conversation.id, text: "Metin" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    // "Zaten kapatılmış" demek kaydın varlığını ve durumunu ele verirdi.
    expect(sonuc.error).toBe("conversation_not_found");
  });

  it("başka dala taşınan soran, artık göremediği konuşmaya yazamaz", async () => {
    const { director, conversation, units } = await konusmaKur();

    // Direktör, faaliyetin üst zincirinden çıkarılıyor: görünürlük güncel
    // ağaçtan hesaplanır (§4.6).
    await testDb.user.update({
      where: { id: director.id },
      data: { orgUnitId: units.planning.id, isUnitManager: false },
    });

    const sonuc = await replyToConversation(
      testDb,
      actor(director),
      { conversationId: conversation.id, text: "Hâlâ yazabiliyor muyum?" },
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("conversation_not_found");
  });

  it("konuşma listesi de görünürlükten geçer", async () => {
    const { peer, director, activity } = await konusmaKur();

    expect(
      await listActivityConversations(testDb, actor(peer), activity.id),
    ).toEqual([]);
    expect(
      (await listActivityConversations(testDb, actor(director), activity.id))
        .length,
    ).toBe(1);
  });
});

// §9.4: soru cevaplanana kadar hem soranın hem sorumlunun listesinde durur.
describe("açık iş listesi", () => {
  it("soran ve sorumlu aynı konuşmayı farklı rolde görür", async () => {
    const { director, author, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    const soraninListesi = await listOpenWorkItems(testDb, actor(director));
    const yazaninListesi = await listOpenWorkItems(testDb, actor(author));

    expect(soraninListesi).toHaveLength(1);
    expect(soraninListesi[0].waitingOnMe).toBe(false);
    expect(yazaninListesi).toHaveLength(1);
    expect(yazaninListesi[0].waitingOnMe).toBe(true);
  });

  it("cevaptan sonra roller yer değiştirir", async () => {
    const { director, author, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: acilis.value.id, text: "Cevap" },
      new Date(NOW.getTime() + 60_000),
    );

    expect((await listOpenWorkItems(testDb, actor(director)))[0].waitingOnMe).toBe(
      true,
    );
    expect((await listOpenWorkItems(testDb, actor(author)))[0].waitingOnMe).toBe(
      false,
    );
  });

  it("kapanan konuşma listeden düşer", async () => {
    const { director, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    await closeConversation(testDb, actor(director), acilis.value.id, NOW);

    expect(await listOpenWorkItems(testDb, actor(director))).toEqual([]);
  });
});

// Denetim (bulgu 5): sorumluluk sorana geçtiğinde faaliyetin yazarı
// hiçbir alanda görünmüyordu ve açık konuşması varken pasifleştirilebiliyordu.
describe("açık konuşma pasifleştirmeyi engeller", () => {
  it("sorumluluk sorana geçse de yazar pasifleştirilemez", async () => {
    const { director, author, activity } = await buildScenario();
    const acilis = await askQuestion(
      testDb,
      actor(director),
      { activityId: activity.id, text: "Soru" },
      NOW,
    );
    if (!acilis.ok) throw new Error("kurulum");

    // Yazar cevaplıyor; sorumluluk sorana geçiyor.
    await replyToConversation(
      testDb,
      actor(author),
      { conversationId: acilis.value.id, text: "Cevap" },
      new Date(NOW.getTime() + 60_000),
    );

    await expect(
      testDb.user.update({
        where: { id: author.id },
        data: { isActive: false, isUnitManager: false },
      }),
    ).rejects.toThrow(/USER_HAS_OPEN_CONVERSATIONS/);
  });
});
