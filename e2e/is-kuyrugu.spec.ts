import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Tek iş kuyruğu (Görev 10.5).
//
// Eskiden "cevap bekleyen sorular" ve "onayımı bekleyenler" iki ayrı kutuydu.
// Sınanan şey: üç farklı iş türü **tek listede** ve her satırda ne yapılacağı,
// kimden geldiği yazıyor mu.

test.describe.configure({ mode: "serial" });

async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

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

test("işi olmayana boş kuyruk gösterilir", async ({ browser }) => {
  const page = await openAs(browser, "e2e-planlama@ornek.test");

  try {
    const kuyruk = page.locator('[data-test="bana-dusenler"]');
    await expect(kuyruk).toContainText("Size düşen bir iş yok.");
  } finally {
    await page.context().close();
  }
});

test("onay ve düzeltme aynı kuyrukta, doğru kişide görünür", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Kuyruk denemesi ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const calisan = await openAs(browser, E2E_WORKER.email);
  const mudur = await openAs(browser, E2E_USER.email);

  try {
    await onayaTabiYap(admin, true);

    await dayanikliGoto(calisan, "/activities/new");
    await calisan.getByLabel("Başlık").fill(baslik);
    await calisan.getByLabel("Açıklama").fill("Kuyruk için kayıt.");
    await calisan.getByRole("button", { name: "Gönder" }).click();
    await expect(calisan).toHaveURL(/\/activities\?kayit=eklendi$/);

    // Müdürün kuyruğunda "Onayla" işi var.
    await dayanikliGoto(mudur, "/");
    const mudurKuyruk = mudur.locator('[data-test="bana-dusenler"]');
    const onaySatiri = mudurKuyruk
      .locator('[data-test="is-satiri"][data-tur="approve"]')
      .filter({ hasText: baslik });
    await expect(onaySatiri).toBeVisible();
    await expect(onaySatiri).toContainText("Onayla");
    await expect(onaySatiri).toContainText("gönderdi");

    // Çalışanın kuyruğunda o iş **yok**.
    await dayanikliGoto(calisan, "/");
    await expect(
      calisan.locator('[data-test="bana-dusenler"]').getByText(baslik),
    ).toHaveCount(0);

    // Müdür düzeltme ister.
    await onaySatiri.getByRole("link", { name: baslik }).click();
    await mudur.getByRole("button", { name: "Düzeltme iste" }).click();
    const form = mudur.locator('[data-test="duzeltme-formu"]');
    await form.getByLabel("Düzeltme gerekçesi").selectOption({ label: "Eksik bilgi" });
    await form.getByRole("button", { name: "Düzeltme iste" }).click();
    await expect(mudur.getByText("Düzeltme istendi", { exact: true })).toBeVisible();

    // Top yazana geçti: iş müdürden düştü, çalışanın kuyruğunda "Düzelt" oldu.
    await dayanikliGoto(mudur, "/");
    await expect(
      mudur.locator('[data-test="bana-dusenler"]').getByText(baslik),
    ).toHaveCount(0);

    await dayanikliGoto(calisan, "/");
    const duzeltSatiri = calisan
      .locator('[data-test="bana-dusenler"]')
      .locator('[data-test="is-satiri"][data-tur="revise"]')
      .filter({ hasText: baslik });
    await expect(duzeltSatiri).toBeVisible();
    await expect(duzeltSatiri).toContainText("Düzelt");
    await expect(duzeltSatiri).toContainText("düzeltme istedi");
  } finally {
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, mudur]) await page.context().close();
  }
});
