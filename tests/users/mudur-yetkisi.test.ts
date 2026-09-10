import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Bölüm müdürünün personel yetkisinin **sınırı** (Paket 1, bulgu 4).
//
// Tasarım müdüre kendi alt ağacında dört iş veriyor: personel ekleme, **ad ve
// unvan** düzenleme, pasifleştirme, şifre sıfırlama tetikleme. Başka hiçbir
// alan onun değildir.
//
// **Neden gerçek sunucu eylemi çağrılıyor:** yetki kararı ekranda değil,
// veriyi değiştiren yolun üstünde durmalı. Ekranda alanı gizlemek koruma
// değildir — istek elle de kurulabilir. Bu testler `FormData`'yı doğrudan
// eyleme veriyor; ekran hiç işin içinde değil.
//
// Denetimde yakalanan yol şuydu: müdürün formunda e-posta ve birim alanları
// **açıkça duruyordu**, sunucu da onları kabul ediyordu. Müdür astının
// e-postasını kendi adresine çevirip "şifre sıfırla" diyebiliyordu; bağlantı
// artık ona gidiyordu. O andan sonra denetim izindeki "bu kaydı kim yazdı"
// cevabı kesin olmaktan çıkar.

const { oturum } = vi.hoisted(() => ({
  oturum: { kisi: null as { id: string; isSystemAdmin: boolean; isUnitManager: boolean } | null },
}));

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: async () => oturum.kisi,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/server/db", async () => {
  const { testDb } = await import("../helpers/test-db");
  return { prisma: testDb };
});

const { createUserAction, updateUserAction } = await import(
  "@/app/admin/users/actions"
);

import { createUser } from "@/server/users/create";
import { updateUserByManager } from "@/server/users/update";

import { createOrgUnit, createUser as seedUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
  oturum.kisi = null;
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Müdür, astı ve ikisinin de içinde olduğu birim. */
async function kur() {
  // Ağaçta tek kök olabilir (kısmi tekil indeks); müdürün ağacı dışında bir
  // birim gerektiği için kök ayrıca kuruluyor.
  const kok = await createOrgUnit({ name: "Şirket" });
  const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
  const digerBirim = await createOrgUnit({ name: "Boyahane", parentId: birim.id });
  const disBirim = await createOrgUnit({ name: "Planlama", parentId: kok.id });

  const mudur = await seedUser(birim.id, {
    fullName: "Kalıphane Müdürü",
    email: "mudur@ornek.test",
    isUnitManager: true,
  });

  const ast = await seedUser(birim.id, {
    fullName: "Kalıphane Çalışanı",
    email: "ast@ornek.test",
    title: "Kalıpçı",
  });

  oturum.kisi = { id: mudur.id, isSystemAdmin: false, isUnitManager: true };
  return { kok, birim, digerBirim, disBirim, mudur, ast };
}

/**
 * Müdürün göndereceği düzenleme isteği.
 *
 * **Bugünkü şemanın istediği bütün alanlar dolu** gönderiliyor: eksik alanla
 * gönderilseydi istek doğrulamada düşerdi ve testler "hiçbir şey değişmedi"
 * diye geçerdi — saldırı yolunu hiç çalıştırmadan. Her test yalnız tek bir
 * alanı düşman değerle değiştiriyor.
 */
function duzenlemeVerisi(
  hedef: { id: string; email: string; orgUnitId: string },
  ekler: Record<string, string> = {},
): FormData {
  const veri = new FormData();
  veri.set("id", hedef.id);
  veri.set("fullName", "Yeni Ad");
  veri.set("title", "Yeni Unvan");
  veri.set("email", hedef.email);
  veri.set("orgUnitId", hedef.orgUnitId);
  veri.set("writesActivities", "on");
  veri.set("isScored", "on");
  veri.set("canAppreciate", "on");
  for (const [alan, deger] of Object.entries(ekler)) veri.set(alan, deger);
  return veri;
}

describe("bölüm müdürünün düzenleme sınırı", () => {
  it("ad ve unvanı değiştirebilir", async () => {
    const { ast } = await kur();

    const sonuc = await updateUserAction(
      { error: null, success: null, blockers: null },
      duzenlemeVerisi(ast),
    );

    expect(sonuc.error).toBeNull();

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: ast.id } });
    expect(guncel.fullName).toBe("Yeni Ad");
    // Unvan tasarımın müdüre verdiği iki alandan biri; taşınmazsa yetki
    // kâğıt üstünde kalır.
    expect(guncel.title).toBe("Yeni Unvan");
  });

  it("e-postayı değiştiremez", async () => {
    const { ast } = await kur();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      duzenlemeVerisi(ast, { email: "saldirgan@ornek.test" }),
    );

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: ast.id } });
    // Hesap devralma yolu tam buradan geçiyordu.
    expect(guncel.email).toBe("ast@ornek.test");
  });

  it("kişiyi başka birime taşıyamaz", async () => {
    const { ast, birim, digerBirim } = await kur();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      duzenlemeVerisi(ast, { orgUnitId: digerBirim.id }),
    );

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: ast.id } });
    expect(guncel.orgUnitId).toBe(birim.id);
  });

  it("astının birim yöneticiliğini düşüremez", async () => {
    const { birim } = await kur();
    const altMudur = await seedUser(birim.id, {
      fullName: "Alt Müdür",
      email: "altmudur@ornek.test",
      isUnitManager: true,
    });

    await updateUserAction(
      { error: null, success: null, blockers: null },
      duzenlemeVerisi(altMudur),
    );

    const guncel = await testDb.user.findUniqueOrThrow({
      where: { id: altMudur.id },
    });
    // Kutu formda hiç yok; sunucu "işaretlenmemiş" diye false yazıyordu.
    expect(guncel.isUnitManager).toBe(true);
  });

  it("skor ve takdir bayraklarını değiştiremez", async () => {
    const { birim } = await kur();
    const hedef = await seedUser(birim.id, {
      fullName: "Takdir Verebilen",
      email: "takdir@ornek.test",
      canAppreciate: true,
    });

    await updateUserAction(
      { error: null, success: null, blockers: null },
      duzenlemeVerisi(hedef, { isScored: "off", canAppreciate: "off" }),
    );

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: hedef.id } });
    expect(guncel.isScored).toBe(true);
    expect(guncel.canAppreciate).toBe(true);
  });

  it("faaliyet yazma beklentisini değiştiremez", async () => {
    const { ast } = await kur();

    await updateUserAction(
      { error: null, success: null, blockers: null },
      duzenlemeVerisi(ast, { writesActivities: "off" }),
    );

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: ast.id } });
    expect(guncel.writesActivities).toBe(true);
  });
});

/**
 * İşlemin ortasında duran veritabanı sarmalayıcısı.
 *
 * İlk okuma bittiğinde `hazir` çözülür ve işlem `bekle` çözülene kadar
 * durur. Böylece "kapsam okundu ama henüz yazılmadı" anında araya girilebilir.
 *
 * **Neden gerekiyor:** ilk yazdığım "yarış" testleri araya girmeyi eylem
 * çağrısından **önce** yapıyordu. O durumda istek daha ön elemede
 * reddediliyor ve asıl korumaya — yazma ifadesinin içindeki kapsam koşuluna —
 * hiç sıra gelmiyordu. Testler geçiyordu ama eski hatalı kod geri konsa yine
 * geçerlerdi; yani bir şey ölçmüyorlardı (23.08.2026, üçüncü denetim turu).
 */
function bariyerliDb(hazirEt: () => void, bekle: Promise<void>) {
  let ilkOkuma = true;

  return {
    ...testDb,
    $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
      testDb.$transaction((tx) =>
        fn(
          new Proxy(tx, {
            get(hedef, alan) {
              if (alan !== "$queryRaw") return Reflect.get(hedef, alan);

              const asil = Reflect.get(hedef, alan) as (
                ...args: unknown[]
              ) => Promise<unknown>;

              return async (...args: unknown[]) => {
                const sonuc = await asil.apply(hedef, args);
                if (ilkOkuma) {
                  ilkOkuma = false;
                  hazirEt();
                  await bekle;
                }
                return sonuc;
              };
            },
          }),
        ),
      )) as typeof testDb.$transaction,
  } as unknown as typeof testDb;
}

/** Bariyer kurar: `hazir` beklenir, araya girilir, `birak()` çağrılır. */
function bariyer() {
  let hazirEt = () => {};
  let birak = () => {};
  const hazir = new Promise<void>((c) => (hazirEt = c));
  const bekle = new Promise<void>((c) => (birak = c));
  return { db: bariyerliDb(() => hazirEt(), bekle), hazir, birak: () => birak() };
}

describe("müdür düzenlemesi yarışa dayanır", () => {
  const yeniAd = { fullName: "Yeni Ad", title: "Yeni Unvan" };

  it("kapsam okunduktan sonra hedefin birimi dışarı taşınırsa yazma geçmez", async () => {
    const { birim, digerBirim, kok, mudur } = await kur();
    const hedef = await seedUser(digerBirim.id, {
      fullName: "Alt Birim Çalışanı",
      email: "altbirim@ornek.test",
    });

    const { db, hazir, birak } = bariyer();
    const cagri = updateUserByManager(db, { id: hedef.id, ...yeniAd }, mudur.id);

    await hazir;
    // Hedefin birimi müdürün dalından çıkarılıyor; hedef satırına
    // dokunulmuyor, dolayısıyla kilide takılmadan geçiyor.
    await testDb.orgUnit.update({
      where: { id: digerBirim.id },
      data: { parentId: kok.id },
    });
    birak();

    const sonuc = await cagri;
    expect(sonuc.ok).toBe(false);

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: hedef.id } });
    expect(guncel.fullName).toBe("Alt Birim Çalışanı");
    expect(guncel.orgUnitId).not.toBe(birim.id);
  });

  it("kapsam okunduktan sonra müdürlük alınırsa yazma geçmez", async () => {
    const { ast, mudur } = await kur();

    const { db, hazir, birak } = bariyer();
    const cagri = updateUserByManager(db, { id: ast.id, ...yeniAd }, mudur.id);

    await hazir;
    // Aktörün kendi satırı; hedefin satırı kilitli olsa da bu geçer.
    await testDb.user.update({
      where: { id: mudur.id },
      data: { isUnitManager: false },
    });
    birak();

    const sonuc = await cagri;
    expect(sonuc.ok).toBe(false);

    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: ast.id } });
    expect(guncel.fullName).toBe("Kalıphane Çalışanı");
  });

  it("denetim kaydının okuduğu satır kilitlidir", async () => {
    const { ast, mudur } = await kur();

    const { db, hazir, birak } = bariyer();
    const cagri = updateUserByManager(db, { id: ast.id, ...yeniAd }, mudur.id);

    await hazir;

    // Kilit alınmasaydı bu güncelleme hemen biterdi ve denetim kaydı gerçek
    // "önce" değerini kaçırırdı. Bloke bir sorgu tamamlanamaz; yön tek
    // taraflı olduğu için ölçüm zamanlamaya rağmen ayırt edici.
    const rakip = testDb.user.update({
      where: { id: ast.id },
      data: { fullName: "Rakip Yazan" },
    });

    const yaris = await Promise.race([
      rakip.then(() => "gecti" as const),
      new Promise<"bekledi">((c) => setTimeout(() => c("bekledi"), 400)),
    ]);
    expect(yaris).toBe("bekledi");

    birak();
    const sonuc = await cagri;
    expect(sonuc.ok).toBe(true);
    await rakip;

    const kayit = await testDb.auditLog.findFirst({
      where: { objectId: ast.id, userId: mudur.id },
      orderBy: { createdAt: "desc" },
    });
    const detay = kayit?.detail as {
      before?: { fullName?: string };
      after?: { fullName?: string };
    };
    expect(detay.before?.fullName).toBe("Kalıphane Çalışanı");
    expect(detay.after?.fullName).toBe("Yeni Ad");
  });

  it("kapsam dışındaki kişi doğrudan servisten de düzenlenemez", async () => {
    const { disBirim, mudur } = await kur();
    const yabanci = await seedUser(disBirim.id, {
      fullName: "Planlamacı",
      email: "planlamaci@ornek.test",
    });

    // Eylemin ön elemesi atlanıyor: sınanan şey servisin kendi kararı.
    const sonuc = await updateUserByManager(
      testDb,
      { id: yabanci.id, ...yeniAd },
      mudur.id,
    );

    expect(sonuc.ok).toBe(false);
    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: yabanci.id } });
    expect(guncel.fullName).toBe("Planlamacı");
  });

  it("müdür kendi hesabını doğrudan servisten de düzenleyemez", async () => {
    const { mudur } = await kur();

    // Aktörün kendi kaydı kendi alt ağacındadır; kapsam koşulu bunu tek
    // başına engellemiyordu. Sunucu eylemindeki ön eleme maskeliyordu ama
    // servis doğrudan yetki sınırı olarak sınanıyor.
    const sonuc = await updateUserByManager(
      testDb,
      { id: mudur.id, ...yeniAd },
      mudur.id,
    );

    expect(sonuc.ok).toBe(false);
    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: mudur.id } });
    expect(guncel.fullName).toBe("Kalıphane Müdürü");
  });

  it("hedef sistem yöneticisiyse doğrudan servisten de düzenlenemez", async () => {
    const { birim, mudur } = await kur();
    const altAdmin = await seedUser(birim.id, {
      fullName: "Alt Sistem Yöneticisi",
      email: "altadmin@ornek.test",
      isSystemAdmin: true,
    });

    const sonuc = await updateUserByManager(
      testDb,
      { id: altAdmin.id, ...yeniAd },
      mudur.id,
    );

    expect(sonuc.ok).toBe(false);
    const guncel = await testDb.user.findUniqueOrThrow({ where: { id: altAdmin.id } });
    expect(guncel.fullName).toBe("Alt Sistem Yöneticisi");
  });
});

describe("bölüm müdürünün ekleme sınırı", () => {
  it("parola belirleyemez; kullanıcı parolasını kendisi kurar", async () => {
    const { birim } = await kur();

    const veri = new FormData();
    veri.set("fullName", "Yeni Personel");
    veri.set("title", "Kalıpçı");
    veri.set("email", "yeni@ornek.test");
    veri.set("orgUnitId", birim.id);
    veri.set("initialPassword", "mudurun-bildigi-parola");

    const sonuc = await createUserAction(
      { error: null, success: null, blockers: null },
      veri,
    );
    expect(sonuc.error).toBeNull();

    const yeni = await testDb.user.findUniqueOrThrow({
      where: { email: "yeni@ornek.test" },
      include: { credential: true },
    });
    expect(yeni.title).toBe("Kalıpçı");

    // Müdürün gönderdiği parola hiçbir yere yazılmamalı: müdürün bildiği
    // parola, denetim izinin "bu kaydı kim yazdı" cevabını zayıflatır.
    const dogruMu = await (
      await import("@/server/auth/password")
    ).verifyPassword("mudurun-bildigi-parola", yeni.credential!.passwordHash);
    expect(dogruMu).toBe(false);

    // Kullanıcıya parola kurma bağlantısı gitmeli, yoksa hesaba girilemez.
    const bildirim = await testDb.notificationQueue.findFirst({
      where: { userId: yeni.id },
    });
    expect(bildirim).not.toBeNull();
  });

  it("eklediği personelden faaliyet beklenir ve skoru hesaplanır", async () => {
    const { birim } = await kur();

    const veri = new FormData();
    veri.set("fullName", "Normal Personel");
    veri.set("email", "normal@ornek.test");
    veri.set("orgUnitId", birim.id);

    await createUserAction({ error: null, success: null, blockers: null }, veri);

    const yeni = await testDb.user.findUniqueOrThrow({
      where: { email: "normal@ornek.test" },
    });

    // Kutuları formdan kaldırmak yetmiyordu: eylem gönderilmeyeni
    // "işaretlenmemiş" sayıp `false` yazıyordu ve müdürün eklediği personel
    // sessizce faaliyet yazmayan, skorlanmayan biri oluyordu.
    expect(yeni.writesActivities).toBe(true);
    expect(yeni.isScored).toBe(true);
    expect(yeni.canAppreciate).toBe(false);
  });

  it("elle kurulmuş istek bayrakları değiştiremez", async () => {
    const { birim } = await kur();

    const veri = new FormData();
    veri.set("fullName", "Düşman İstek");
    veri.set("email", "dusman@ornek.test");
    veri.set("orgUnitId", birim.id);
    veri.set("writesActivities", "off");
    veri.set("isScored", "off");
    veri.set("canAppreciate", "on");

    await createUserAction({ error: null, success: null, blockers: null }, veri);

    const yeni = await testDb.user.findUniqueOrThrow({
      where: { email: "dusman@ornek.test" },
    });
    expect(yeni.writesActivities).toBe(true);
    expect(yeni.isScored).toBe(true);
    expect(yeni.canAppreciate).toBe(false);
  });

  it("rol veremez", async () => {
    const { birim } = await kur();

    const veri = new FormData();
    veri.set("fullName", "Yetkili Olmak İsteyen");
    veri.set("email", "yetki@ornek.test");
    veri.set("orgUnitId", birim.id);
    veri.set("isSystemAdmin", "on");
    veri.set("isUnitManager", "on");
    // Bugünkü şema parolayı zorunlu tutuyor; göndermezsek istek doğrulamada
    // düşer ve test rol kuralını hiç sınamamış olur.
    veri.set("initialPassword", "baslangic-parolasi-1");

    await createUserAction({ error: null, success: null, blockers: null }, veri);

    const yeni = await testDb.user.findUniqueOrThrow({
      where: { email: "yetki@ornek.test" },
    });
    expect(yeni.isSystemAdmin).toBe(false);
    expect(yeni.isUnitManager).toBe(false);
  });
});

describe("müdür eklemesinin kapsamı serviste", () => {
  it("kapsam dışındaki birime doğrudan servisten de eklenemez", async () => {
    const { disBirim, mudur } = await kur();

    // Eylemin ön elemesi atlanıyor: kapsam kararı servisin kendi işleminde,
    // ağaç kilidi altında veriliyor. Dışarıda hesaplanıp taşınan bir liste
    // arada ağaç değiştiğinde bayat kalırdı.
    const sonuc = await createUser(
      testDb,
      {
        fullName: "Kapsam Dışı",
        email: "kapsam-disi@ornek.test",
        orgUnitId: disBirim.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "baslangic-parolasi-1",
      },
      mudur.id,
      new Date(),
      { managerScope: { actorId: mudur.id } },
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("out_of_scope");

    const kalan = await testDb.user.findUnique({
      where: { email: "kapsam-disi@ornek.test" },
    });
    expect(kalan).toBeNull();
  });

  it("müdürlüğü alınmış aktör ekleme yapamaz", async () => {
    const { birim, mudur } = await kur();

    await testDb.user.update({
      where: { id: mudur.id },
      data: { isUnitManager: false },
    });

    const sonuc = await createUser(
      testDb,
      {
        fullName: "Yetkisiz Ekleme",
        email: "yetkisiz-ekleme@ornek.test",
        orgUnitId: birim.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "baslangic-parolasi-1",
      },
      mudur.id,
      new Date(),
      { managerScope: { actorId: mudur.id } },
    );

    expect(sonuc.ok).toBe(false);
    const kalan = await testDb.user.findUnique({
      where: { email: "yetkisiz-ekleme@ornek.test" },
    });
    expect(kalan).toBeNull();
  });
});

describe("müdür eklemesi ağaç kilidiyle korunuyor", () => {
  it("kapsam okunduktan sonra birim taşıması kilide takılır", async () => {
    const { kok, digerBirim, mudur } = await kur();

    const { db, hazir, birak } = bariyer();

    // Bariyer, kapsam sorgusundan **sonra** ve ekleme öncesinde duruyor:
    // kilit alınmasaydı tam bu aralıkta ağaç değişebilir ve kayıt kapsam dışı
    // bir birime açılabilirdi.
    const cagri = createUser(
      db,
      {
        fullName: "Kilit Denemesi",
        email: "kilit@ornek.test",
        orgUnitId: digerBirim.id,
        isUnitManager: false,
        isSystemAdmin: false,
        writesActivities: true,
        initialPassword: "baslangic-parolasi-1",
      },
      mudur.id,
      new Date(),
      { managerScope: { actorId: mudur.id } },
    );

    await hazir;

    // Birimi müdürün dalından çıkarmayı dene. Birim taşıyan tetikleyici aynı
    // danışma kilidini aldığı için bu işlem beklemek zorunda.
    const tasima = testDb.orgUnit.update({
      where: { id: digerBirim.id },
      data: { parentId: kok.id },
    });

    const yaris = await Promise.race([
      tasima.then(() => "gecti" as const),
      new Promise<"bekledi">((c) => setTimeout(() => c("bekledi"), 400)),
    ]);

    // `pg_advisory_xact_lock` satırı silinirse taşıma hemen biter ve bu
    // beklenti kırılır; testi kıracak üretim değişikliği tam olarak budur.
    expect(yaris).toBe("bekledi");

    birak();

    const sonuc = await cagri;
    expect(sonuc.ok).toBe(true);
    await tasima;

    const yeni = await testDb.user.findUnique({
      where: { email: "kilit@ornek.test" },
    });
    expect(yeni).not.toBeNull();
  });
});
