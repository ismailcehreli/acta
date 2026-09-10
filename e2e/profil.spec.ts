import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Profil sayfası (Görev 9.4).
//
// Ağaç: Genel Müdürlük → Kalıphane (Deneme Müdürü + Kalıphane Çalışanı)
//                      → Planlama (Planlama Müdürü)
//
// Sınanan üç şey: kişi kendi profiline menüden ulaşır, yöneticisi astının
// profilini görür, kapsam dışındaki müdür **adresi bilse bile** göremez.

/** Birim bayrağını açıp kapatır; onay akışı sınaması için gerekli. */
async function onayaTabiYap(page: Page, acik: boolean): Promise<void> {
  await dayanikliGoto(page, "/admin/org");
  const satir = page.locator('[data-birim="Kalıphane"]');
  await satir.getByRole("button", { name: "Düzenle" }).click();

  const form = satir.locator("form[data-test^='birim-duzenle-']");
  const kutu = form.getByRole("checkbox", {
    name: "Bu birimdeki faaliyetler onaya tabidir",
  });
  if (acik) await kutu.check();
  else await kutu.uncheck();
  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();

  await dayanikliGoto(page, "/admin/org");
  const guncel = page.locator('[data-birim="Kalıphane"]');
  if (acik) {
    await expect(guncel.getByText("onaya tabi", { exact: true })).toBeVisible();
  } else {
    await expect(guncel.getByText("onaya tabi", { exact: true })).toHaveCount(0);
  }
}

/** Ayrı bağlamda giriş; çerez temizlemeden. */
async function girisYap(page: Page, email: string): Promise<void> {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("kişi kendi profilini hesap menüsünden açar", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);

  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();

  await expect(page).toHaveURL(/\/users\//);
  await expect(
    page.getByRole("heading", { name: E2E_WORKER.fullName }),
  ).toBeVisible();
  // Özet blokları kişinin kendi kapsamıyla hesaplanır.
  await expect(page.getByText("Toplam", { exact: true })).toBeVisible();
});

test("yönetici astının profilini faaliyet sayfasından açar", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);

  // Çalışan bir faaliyet yazar.
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Profil denemesi");
  await page.getByLabel("Açıklama").fill("Profil sayfası için örnek kayıt.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  // Müdür kaydı kapsam akışından açar ve yazarın adına tıklar.
  await loginAs(page, E2E_USER.email);
  await page.getByRole("link", { name: /Profil denemesi/ }).first().click();
  await expect(page).toHaveURL(/\/activities\//);
  await page.getByRole("link", { name: E2E_WORKER.fullName }).click();

  await expect(
    page.getByRole("heading", { name: E2E_WORKER.fullName }),
  ).toBeVisible();
  // Astın arşivi müdüre görünür.
  //
  // Bağlantıya daraltılıyor: Next gezinmeden sonra sayfa başlığını ekran
  // okuyucular için gizli bir "rota anonsu" düğümüne de yazıyor ve düz metin
  // araması iki sonuç buluyordu (22.08.2026, WebKit koşusu).
  await expect(
    page.getByRole("link", { name: "Profil denemesi" }).first(),
  ).toBeVisible();
});

test("kapsam dışındaki müdür profili adresle de açamaz", async ({ page }) => {
  // Önce adresi ele geçirelim: çalışanın kendi profil adresi.
  await loginAs(page, E2E_WORKER.email);
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();
  await expect(page).toHaveURL(/\/users\//);
  const adres = page.url();

  // Planlama Müdürü başka bir daldadır; çalışan onun astı değildir.
  await loginAs(page, E2E_PLANNER.email);
  const yanit = await dayanikliGoto(page, adres);

  expect(yanit?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: E2E_WORKER.fullName }),
  ).toHaveCount(0);
});


test("onay bekleyen kayıt üst yöneticinin profilinde hiç görünmez", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Profilde bekleyen ${suffix}`;

  const admin = await browser.newContext().then((c) => c.newPage());
  await girisYap(admin, E2E_ADMIN.email);
  const calisan = await browser.newContext().then((c) => c.newPage());
  await girisYap(calisan, E2E_WORKER.email);
  const genelMudur = await browser.newContext().then((c) => c.newPage());
  await girisYap(genelMudur, E2E_GM.email);

  try {
    // Kalıphane onaya tabi olsun ki kayıt müdürde beklesin.
    await onayaTabiYap(admin, true);

    await dayanikliGoto(calisan, "/activities/new");
    await calisan.getByLabel("Başlık").fill(baslik);
    await calisan.getByLabel("Açıklama").fill("Profil sınaması için kayıt.");
    await calisan
      .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
      .check();
    await calisan.getByRole("button", { name: "Gönder" }).click();
    await expect(calisan).toHaveURL(/\/activities\?/);

    // Çalışanın profil adresini al.
    await calisan.getByRole("button", { name: "Hesap menüsü" }).click();
    await calisan.getByRole("menuitem", { name: "Profilim" }).click();
    await expect(calisan).toHaveURL(/\/users\//);
    const profilAdresi = calisan.url();

    // §8.2: üst zincir yalnız onaylı ve iptal kayıtları görür. Bekleyen
    // kaydın başlığı, durumu ve varlığı profil arşivinden sızmaz.
    await dayanikliGoto(genelMudur, profilAdresi);
    await expect(
      genelMudur.locator('[data-test="profil-faaliyet"]').filter({ hasText: baslik }),
    ).toHaveCount(0);

    // Akışta da yoktur; süzgeç yerinde duruyor.
    await dayanikliGoto(genelMudur, "/");
    await expect(genelMudur.getByText(baslik)).toHaveCount(0);
  } finally {
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, genelMudur]) {
      await page.context().close();
    }
  }
});
