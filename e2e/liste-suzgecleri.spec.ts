import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_DYER,
  E2E_DYE_MANAGER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Listeleyen sayfaların süzgeç ve sayfalama standardı (Görev 11.3).
//
// Sınanan üç şey: süzgeç gerçekten daraltıyor mu, sayfalama süzgeci koruyor
// mu, ve boş liste boşluğun sebebini söylüyor mu.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

const IPTAL_EDILEN = `İptal edilecek ${String(Date.now()).slice(-6)}`;
const DURAN = `Duran kayıt ${String(Date.now()).slice(-6)}`;

test("faaliyetlerim: durum süzgeci listeyi daraltır", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  for (const baslik of [IPTAL_EDILEN, DURAN]) {
    await dayanikliGoto(page, "/activities/new");
    await page.getByLabel("Başlık").fill(baslik);
    await page.getByLabel("Açıklama").fill(`${baslik} için açıklama metni.`);
    await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
    await page.getByRole("button", { name: "Gönder" }).click();
    await expect(page).toHaveURL(/kayit=eklendi/);
  }

  // Birini iptal et: iki farklı durumda kayıt olsun.
  const satir = page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: IPTAL_EDILEN });
  await satir.getByRole("link", { name: "İptal et", exact: true }).click();
  await page.getByLabel("İptal gerekçesi").fill("Yanlış girildi, iptal ediliyor.");
  await page.getByRole("button", { name: "Faaliyeti iptal et" }).click();
  await expect(page).toHaveURL(/kayit=iptal/);

  // Süzgeç: yalnız iptal edilenler.
  await page.getByLabel("Durum").selectOption("iptal");
  await page.getByRole("button", { name: "Uygula" }).click();

  await expect(page).toHaveURL(/durum=iptal/);
  await expect(page.getByText(IPTAL_EDILEN)).toBeVisible();
  await expect(page.getByText(DURAN)).toHaveCount(0);
});

test("faaliyetlerim: süzgeç sayfalamada korunur", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities?durum=iptal&boyut=25");

  // Sayfa boyu seçimi süzgeci düşürmemeli.
  await page.getByLabel("Sayfada").selectOption("50");
  await page.getByRole("button", { name: "Uygula" }).click();

  await expect(page).toHaveURL(/durum=iptal/);
  await expect(page).toHaveURL(/boyut=50/);
});

test("faaliyetlerim: boş liste boşluğun sebebini söyler", async ({ page }) => {
  // Sistem yöneticisi hesabı faaliyet yazmıyor ve hiçbir spec onun adına
  // kayıt açmıyor: "bugün iptal edilmiş kendi kaydım" kesin boş kalır.
  //
  // Kalıphane hesapları kullanılamaz — birimin onay bayrağını başka spec'ler
  // açıp kapatıyor ve "onay bekleyen kaydı olmaz" varsayımı paralel koşuda
  // çürüyor.
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/activities?durum=iptal&period=today");

  await expect(
    page.getByRole("heading", { name: "Süzgece uyan kayıt yok." }),
  ).toBeVisible();
  // "İlk faaliyeti yaz" çağrısı burada yanlış yönlendirme olurdu.
  await expect(page.getByRole("link", { name: "İlk faaliyeti yaz" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Süzgeci temizle" }).first(),
  ).toBeVisible();
});

test("taslaklar: kayıt türü süzgeci ayrımı gösterir", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  const elle = `Bilerek bırakılan ${String(Date.now()).slice(-6)}`;
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(elle);
  await page.getByLabel("Açıklama").fill("Sonra tamamlayacağım.");
  await page.getByRole("button", { name: "Taslak olarak kaydet" }).click();
  await expect(page).toHaveURL(/\/drafts\?kayit=taslak$/);

  // Elle bırakılanlar süzgeci: kayıt görünür.
  await page.getByLabel("Kayıt türü").selectOption("elle");
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page).toHaveURL(/tur=elle/);
  await expect(page.getByText(elle)).toBeVisible();

  // Kazara kalanlar süzgeci: aynı kayıt görünmez.
  await page.getByLabel("Kayıt türü").selectOption("otomatik");
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page).toHaveURL(/tur=otomatik/);
  await expect(page.getByText(elle)).toHaveCount(0);
});

test("arama: sayfalama bağlantısı süzgeçleri taşır", async ({ page }) => {
  // Bağlantı yalnız arama kelimesini taşıyordu; süzgeç uygulayıp ikinci
  // sayfaya geçen kullanıcı bütün daraltmasını kaybediyordu (Görev 11.3).
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/search?q=kayıt&period=all&boyut=25");

  // Süzgeç şeridi sayfa boyu seçicisini de taşıyor.
  await expect(page.getByLabel("Sayfada")).toBeVisible();

  // Sonraki sayfa bağlantısı varsa süzgeçleri taşımalı.
  const sonraki = page.locator('[data-test="sonraki-sayfa"]');
  if (await sonraki.count()) {
    const href = await sonraki.getAttribute("href");
    expect(href).toContain("period=all");
    expect(href).toContain("boyut=25");
  }
});

test("onaylar: kişi süzgeci kuyruğu daraltır", async ({ page }) => {
  // Boyahane kalıcı olarak onaya tabi bir birimdir ve bayrağını hiçbir spec
  // değiştirmez; onay kuyruğu senaryoları burada kurulur.
  const baslik = `Onaya düşecek ${String(Date.now()).slice(-6)}`;

  await girisYap(page, E2E_DYER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Onay kuyruğu süzgecini sınamak için.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/kayit=eklendi/);

  await girisYap(page, E2E_DYE_MANAGER.email);
  await dayanikliGoto(page, "/approvals");
  await expect(page.getByText(baslik)).toBeVisible();

  // Kişi süzgeci: yazarı seçince kayıt kalır.
  await page.getByLabel("Kişi").selectOption({ label: E2E_DYER.fullName });
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page).toHaveURL(/authorId=/);
  await expect(page.getByText(baslik)).toBeVisible();

  // Süzgeç şeridi her listede aynı: sayfa boyu da burada.
  await expect(page.getByLabel("Sayfada")).toBeVisible();
});

test("takipler: tek liste, rozetler ve süzgeçler", async ({ page }) => {
  const baslik = `Takipli kayıt ${String(Date.now()).slice(-6)}`;

  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Takip maddesi açılacak kayıt.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  // Takip maddesi kayıt yazılırken açılır.
  await page.getByRole("checkbox", { name: "Bu konu açık kalsın" }).check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/kayit=eklendi/);

  await dayanikliGoto(page, "/follow-ups");

  // Grup başlıkları kalktı; tek liste ve sahiplik rozeti var.
  await expect(page.getByText(baslik)).toBeVisible();
  const satir = page.locator('[data-test="takip-satiri"]').filter({ hasText: baslik });
  await expect(satir.getByText("sizde")).toBeVisible();

  // Kapanmış maddeler süzgeci: açık madde görünmez.
  await page.getByLabel("Durum").selectOption("kapali");
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page).toHaveURL(/durum=kapali/);
  await expect(page.getByText(baslik)).toHaveCount(0);

  // Süzgeç şeridi her listede aynı: sayfa boyu burada da var.
  await expect(page.getByLabel("Sayfada")).toBeVisible();
});

test("kullanıcı yönetimi: arama ve durum süzgeci", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/users");

  // Arama: ada göre daraltır.
  await page.getByLabel("Ad ya da e-posta").fill("Kalıphane Çalışanı");
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText(E2E_WORKER.fullName).first()).toBeVisible();

  // Durum süzgeci ve sayfa boyu aynı şeritte.
  await expect(page.getByLabel("Hesap durumu")).toBeVisible();
  await expect(page.getByLabel("Sayfada")).toBeVisible();
});

test("ekip izinleri: kişi süzgeci başkasının kaydını açmaz", async ({ page }) => {
  // Süzgeç, ekip koşulunu **ezmemeli**. Prisma'da aynı alan iki kez verilince
  // sonuncusu kazandığı için ilk yazımda kişi süzgeci `userId in ekip`
  // koşulunu eziyordu ve asta olmayan birinin izin kaydı görülebiliyordu
  // (Görev 11.4, birim testiyle bulundu). Bu test yolun ucunda aynı şeyi
  // sınıyor: adres çubuğuna yabancı bir kimlik yazmak kayıt getirmemeli.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/team/absence");

  const secenekler = await page.getByLabel("Kime ait").locator("option").count();
  // Süzgeç seçenekleri yalnız kapsamdan gelir; "Herkes" + ekip kadar.
  expect(secenekler).toBeGreaterThan(1);

  // Kapsam dışı bir kimlikle sorgu: liste boş kalmalı, hata vermemeli.
  await dayanikliGoto(page, "/team/absence?kisi=00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: /Süzgece uyan kayıt yok/ })).toBeVisible();
});

test("denetim izi: sayfa boyu seçimi süzgeci korur", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/audit?objectType=user");

  await expect(page.getByLabel("Sayfada")).toBeVisible();
  await page.getByLabel("Sayfada").selectOption("50");
  await page.getByRole("button", { name: "Süz" }).click();

  await expect(page).toHaveURL(/objectType=user/);
  await expect(page).toHaveURL(/boyut=50/);
});
