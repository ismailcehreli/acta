import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// §13: ekran düzeni her kademede aynıdır, yalnızca kapsam genişler. Bu dosya
// üç kademeyi gerçek kullanıcılarla dolaşır ve listenin görünürlük modülünden
// beslendiğini gösterir.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  // Aynı sayfada kademe değiştiriyoruz; açık oturum kalırsa /login ana sayfaya
  // yönlenir ve form hiç görünmez.
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string) {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(title);
  await page.getByLabel("Açıklama").fill(`${title} için açıklama metni.`);
  // Tam eşleşme: paralel koşan organizasyon testleri "Kalıphane 1234" gibi
  // birimler oluşturup pasifleştiriyor; bulanık eşleşme onlardan birini seçip
  // kaydı "pasif departman" hatasına düşürebiliyordu.
  // Etiket, kişinin kendi birimiyse "(kendi biriminiz)" eki alır; kalıp bunu
  // kapsar ama "Kalıphane 1234" gibi test birimlerini dışarıda bırakır.
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);
  // Kaydın gerçekten oluştuğunu doğrula: sonraki adımlar buna dayanıyor.
  await expect(page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: title })).toBeVisible();
}

test("her kademe kendi kapsam başlığını görür", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await expect(
    page.getByRole("heading", { name: "Departmanım", exact: true }),
  ).toBeVisible();

  await loginAs(page, E2E_GM.email);
  await expect(
    page.getByRole("heading", { name: "Departmanlarım", exact: true }),
  ).toBeVisible();

  await loginAs(page, E2E_CHAIRMAN.email);
  await expect(
    page.getByRole("heading", { name: "Tüm şirket", exact: true }),
  ).toBeVisible();
});

test("astı olmayan kullanıcıya kapsam listesi gösterilmez", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);

  await expect(
    page.getByText("Başkalarının faaliyetleri", { exact: false }),
  ).toBeVisible();
  // Asıl iddia: kapsam akışı ve süzgeçleri hiç render edilmiyor.
  await expect(page.getByLabel("Kişi")).toHaveCount(0);
  await expect(page.getByLabel("İlgili departman")).toHaveCount(0);
});

test("kapsam listesi görünürlük modülünden beslenir", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const kalipBasligi = `Kalıphane işi ${suffix}`;
  const planlamaBasligi = `Planlama işi ${suffix}`;

  // Kalıphane çalışanı ve Planlama müdürü birer faaliyet yazsın.
  await loginAs(page, E2E_WORKER.email);
  await writeActivity(page, kalipBasligi);

  const planlamaOturumu = await browser.newContext();
  try {
    const planlamaSayfasi = await planlamaOturumu.newPage();
    await loginAs(planlamaSayfasi, E2E_PLANNER.email);
    await writeActivity(planlamaSayfasi, planlamaBasligi);
  } finally {
    await planlamaOturumu.close();
  }

  // Kalıphane Müdürü yalnızca kendi departmanını görür.
  await loginAs(page, E2E_USER.email);
  await expect(page.getByText(kalipBasligi)).toBeVisible();
  await expect(page.getByText(planlamaBasligi)).toHaveCount(0);

  // Genel Müdür iki departmanı da görür.
  await loginAs(page, E2E_GM.email);
  await expect(page.getByText(kalipBasligi)).toBeVisible();
  await expect(page.getByText(planlamaBasligi)).toBeVisible();

  // Sistem yöneticisi ağaçta kimsenin üstünde değildir: hiçbirini görmez.
  await loginAs(page, E2E_ADMIN.email);
  await expect(page.getByText(kalipBasligi)).toHaveCount(0);
  await expect(page.getByText(planlamaBasligi)).toHaveCount(0);
});

// Süzgeçler 20.08.2026'da akış sayfasına taşındı: ana ekran özet oldu.
test("akış sayfasında filtreler listeyi daraltır", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Filtre denemesi ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  await writeActivity(page, baslik);

  await loginAs(page, E2E_GM.email);
  await dayanikliGoto(page, "/feed");
  await expect(page.getByText(baslik)).toBeVisible();

  // Planlama Müdürü'ne göre süz: Kalıphane çalışanının kaydı düşmeli.
  await page.getByLabel("Kişi").selectOption({ label: E2E_PLANNER.fullName });
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page.getByText(baslik)).toHaveCount(0);

  // Kişi filtresi kapsam dışına çıkamaz: seçenekler yalnızca kapsamdakilerdir.
  await expect(page.getByLabel("Kişi")).not.toContainText(E2E_ADMIN.fullName);
});

test("sistem yöneticisi işletim bloğunu görür, başkası görmez", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);

  // İşletim bloğu §12.4: zamanlayıcı durursa sistem çalışıyor görünür.
  // İddia bloğa daraltılır: yönetim gezinmesinde de "Zamanlanmış işler"
  // bağlantısı var ve sayfa genelinde arayan iddia iki eşleşme buluyordu.
  const blok = page.locator('[data-test="sistem-durumu"]');
  await expect(page.getByRole("heading", { name: "Sistem durumu" })).toBeVisible();
  await expect(blok.getByText("Zamanlanmış iş")).toBeVisible();
  await expect(blok.getByText("Son yedek")).toBeVisible();

  // Blok faaliyet içeriği taşımaz (§15.1): yalnız sayılar ve durum.
  await expect(
    page.getByText("Yalnız sistem yöneticisine görünür", { exact: false }),
  ).toBeVisible();

  await loginAs(page, E2E_USER.email);
  await expect(page.getByRole("heading", { name: "Sistem durumu" })).toHaveCount(0);
});

test("ekip katılımı bloğu varsayılan olarak görünmez", async ({ page }) => {
  await loginAs(page, E2E_GM.email);

  // §12.1: yöneticiye katılım özeti varsayılan **kapalıdır**; zorunlu
  // görünürlük içi boş faaliyet yazdırabilir.
  await expect(page.getByRole("heading", { name: "Ekip katılımı" })).toHaveCount(0);
});

test("gezinme menüsü kademeye göre değişir", async ({ page }) => {
  const menu = page.getByRole("navigation", { name: "Ana menü" });

  // Yönetim, ana gezinmede ayrı ve belirgin bir "çalışma alanı" grubudur:
  // sistem operasyonları faaliyet içeriğiyle aynı bağlamda karışmaz.
  await loginAs(page, E2E_ADMIN.email);
  await expect(menu.getByText("Yönetim", { exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Kullanıcılar" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "İşlem kayıtları" })).toBeVisible();

  // Sistem yöneticisi olmayanda yönetim grubu hiç render edilmez: görmediği
  // bağlantı kullanıcıyı yetkisiz bir ekrana götürmez.
  await loginAs(page, E2E_WORKER.email);
  await expect(menu.getByText("Yönetim", { exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "İşlem kayıtları" })).toHaveCount(0);
  // Astı olmayanda ekip bağlantısı da yok.
  await expect(menu.getByRole("link", { name: "Ekip" })).toHaveCount(0);

  await loginAs(page, E2E_USER.email);
  await expect(menu.getByRole("link", { name: "Ekip" })).toBeVisible();
});

test("birden fazla departmanı olan yönetici departman özetini görür", async ({
  page,
}) => {
  // Genel Müdür'ün altında Kalıphane ve Planlama var (global-setup ağacı).
  await loginAs(page, E2E_GM.email);

  const ozet = page.locator('[data-test="departman-ozeti"]');
  await expect(ozet).toBeVisible();
  await expect(ozet).toContainText("Kalıphane");
  await expect(ozet).toContainText("Planlama");

  // Satıra tıklayınca **akış sayfası** o departmana daralmış olarak açılır
  // ve süzgeç kutusu adresle uyumlu gelir (20.08.2026: akış ayrı sayfada).
  await ozet.getByRole("link", { name: /Kalıphane/ }).click();
  await expect(page).toHaveURL(/\/feed\?.*authorOrgUnitId=/);
  await expect(page.getByLabel("Yazan departman")).not.toHaveValue("");
});

test("tek departmanlı yöneticide departman özeti çıkmaz", async ({ page }) => {
  // Deneme Müdürü yalnız Kalıphane'nin yöneticisi; blok akışı tekrar ederdi.
  await loginAs(page, E2E_USER.email);

  await expect(page.locator('[data-test="departman-ozeti"]')).toHaveCount(0);
});
