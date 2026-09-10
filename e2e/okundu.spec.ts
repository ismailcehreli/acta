import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// §10: okuma otomatik toplanır; yazan "okudu" bilgisini görür, yönetici
// ekibinin ne okuduğunu göremez.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string): Promise<string> {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(title);
  await page.getByLabel("Açıklama").fill(`${title} için açıklama.`);
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const href = await page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title, exact: false })
    .getAttribute("href");
  return href as string;
}

test("okuyunca yazan tarafında 'okudu' görünür", async ({ page, browser }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Okundu denemesi ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detayUrl = await writeActivity(page, baslik);

  // Üst kademe detayı açar ve ekranda kalır.
  const okuyanOturum = await browser.newContext();
  try {
    const okuyan = await okuyanOturum.newPage();
    await loginAs(okuyan, E2E_USER.email);

    // Ana ekranda önce okunmamış görünür.
    const satir = okuyan
      .locator('[data-test="yonetilen-alan"] [data-test="akis-satiri"]')
      .filter({ hasText: baslik });
    await expect(satir).toHaveAttribute("data-okundu", "hayir");

    await dayanikliGoto(okuyan, detayUrl);
    // Ölçüm iki saniye sonra düşer (§10.2).
    await okuyan.waitForTimeout(3_000);
    await expect(okuyan.locator("#okundu-bilgisi")).toContainText("okudunuz");

    // Server Action yenilemesi, sayfa yeniden yüklenmeden istemci içi
    // gezinmede de güncel durumu taşımalı.
    await okuyan
      .getByRole("navigation", { name: "Sayfa yolu" })
      .getByRole("link", { name: "Ana ekran", exact: true })
      .click();
    await expect(okuyan).toHaveURL(/\/$/);
    await expect(
      okuyan
        .locator('[data-test="yonetilen-alan"] [data-test="akis-satiri"]')
        .filter({ hasText: baslik }),
    ).toHaveAttribute("data-okundu", "evet");
  } finally {
    await okuyanOturum.close();
  }

  // Yazan, kimin okuduğunu görür.
  await dayanikliGoto(page, detayUrl);
  await expect(page.locator("#okundu-bilgisi")).toContainText("Okuyanlar");
  await expect(page.locator("#okundu-bilgisi")).toContainText(E2E_USER.fullName);
});

test("okunmamış faaliyet dikkat kuyruğundan filtreli akışa açılır", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = "Dikkat kuyruğu denemesi " + suffix;

  await loginAs(page, E2E_WORKER.email);
  await writeActivity(page, baslik);

  const yoneticiOturum = await browser.newContext();
  try {
    const yonetici = await yoneticiOturum.newPage();
    await loginAs(yonetici, E2E_USER.email);
    await dayanikliGoto(yonetici, "/");

    const kuyruk = yonetici.locator('[data-test="okunmamis-kuyrugu"]');
    await expect(kuyruk).toBeVisible();
    await expect(
      yonetici
        .getByRole("navigation", { name: "Ana menü" })
        .getByRole("link", { name: "Yönettiğim faaliyetler" }),
    ).toHaveAttribute("href", "/feed?period=all&okunmamis=1");
    const kuyrukSatiri = kuyruk
      .locator('[data-test="akis-satiri"]')
      .filter({ hasText: baslik });
    await expect(kuyrukSatiri).toHaveAttribute("data-okundu", "hayir");
    await expect(
      kuyrukSatiri.locator("span.inline-flex").filter({ hasText: "Okunmadı" }),
    ).toBeVisible();

    await kuyruk
      .getByRole("link", { name: "Tüm okunmamışları gör" })
      .click();
    await expect(yonetici).toHaveURL(/\/feed\?period=all&okunmamis=1/);
    await expect(
      yonetici.locator('[data-test="okunmamis-filtresi"]'),
    ).toContainText("Yalnızca okunmamış faaliyetler");

    const filtreliSatir = yonetici
      .locator('[data-test="akis-satiri"]')
      .filter({ hasText: baslik });
    await expect(filtreliSatir).toHaveAttribute("data-okundu", "hayir");
    await expect(
      filtreliSatir.locator("span.inline-flex").filter({ hasText: "Okunmadı" }),
    ).toBeVisible();

    await yonetici
      .getByRole("link", { name: "Okunmamış filtresini kaldır" })
      .click();
    await expect(yonetici).not.toHaveURL(/okunmamis=1/);
  } finally {
    await yoneticiOturum.close();
  }
});

test("faaliyeti göremeyen kişi okuma bilgisini de göremez", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Okuma gizliliği ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  const detayUrl = await writeActivity(page, baslik);

  const akranOturum = await browser.newContext();
  try {
    const akran = await akranOturum.newPage();
    await loginAs(akran, E2E_PLANNER.email);
    const cevap = await dayanikliGoto(akran, detayUrl);

    expect(cevap?.status()).toBe(404);
    await expect(akran.locator("#okundu-bilgisi")).toHaveCount(0);
  } finally {
    await akranOturum.close();
  }
});
