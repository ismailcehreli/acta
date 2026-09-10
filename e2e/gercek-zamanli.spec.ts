import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import { E2E_GM, E2E_USER, e2ePassword } from "./global-setup";

// Gerçek zamanlı güncelleme (Görev 7.3).
//
// Kanıtın şartı: **hiçbir yeniden yükleme yapılmadan** ekranın değişmesi. Bu
// yüzden testler sayfayı bir kez açar, `page.reload()` çağırmaz ve beklenen
// metnin kendiliğinden gelmesini bekler. Sayfa yenilenseydi test, gerçek
// zamanlılığı değil yeniden yüklemeyi doğrulardı.

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Ayrı tarayıcı bağlamı: iki kişi aynı anda açık. */
async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, email);
  return page;
}

async function writeActivity(page: Page, title: string): Promise<string> {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(title);
  await page.getByLabel("Açıklama").fill(`${title} için açıklama.`);
  // İlgili departman zorunlu; seçilmezse form gönderilmez.
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  // Kaydetme `/activities?kayit=eklendi` adresine döner. Gevşek bir kalıp
  // (`/activities`) form sayfasıyla da eşleşiyor ve satır aramasını henüz
  // yönlenmemiş sayfada başlatıyordu.
  await expect(page).toHaveURL(/\/activities\?/);

  const link = page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: title })
    .getByRole("link", { name: title, exact: false });
  return (await link.getAttribute("href")) as string;
}

test("olay akışı oturumsuz açılmaz", async ({ page }) => {
  await page.context().clearCookies();
  const response = await page.request.get("/api/events");

  expect(response.status()).toBe(401);
});

test("sorulan soru, yazanın ana ekranına yenileme olmadan düşer", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Canlı akış ${suffix}`;

  const yazan = await openAs(browser, E2E_USER.email);
  const soran = await openAs(browser, E2E_GM.email);

  try {
    const yol = await writeActivity(yazan, baslik);

    // Akışın gerçekten kurulduğu doğrulanır; kurulmadan sorulan soru testi
    // yanlış nedenle kırardı. SSE isteği `performance` kayıtlarına düşmüyor
    // (istek hiç bitmiyor), bu yüzden yanıt başlıkları beklenir.
    const akisKuruldu = yazan.waitForResponse(
      (r) => r.url().includes("/api/events"),
      { timeout: 20_000 },
    );

    // Yazan kişi ana ekranında bekliyor. **Bu kayıt** henüz kuyruğunda yok.
    //
    // Kuyruğun tümüyle boş olduğunu iddia etmiyoruz: başka testlerin bıraktığı
    // işler orada olabilir ve o zaman bu test kendi konusuyla ilgisiz bir
    // sebeple kırılırdı.
    await dayanikliGoto(yazan, "/");
    const banaDusenlerOnce = yazan.locator('[data-test="bana-dusenler"]');
    await expect(
      yazan.getByRole("heading", { name: "Bana düşenler" }),
    ).toBeVisible();
    await expect(banaDusenlerOnce.getByText(baslik)).toHaveCount(0);

    const akisYaniti = await akisKuruldu;
    expect(akisYaniti.status()).toBe(200);

    // Öteki kişi soruyu sorar.
    await dayanikliGoto(soran, yol);
    await soran.getByLabel("Soru sor").fill("Bu kalıpta ne yapıldı?");
    await soran.getByRole("button", { name: "Soruyu gönder" }).click();
    await expect(soran.getByText("Bu kalıpta ne yapıldı?")).toBeVisible();

    // Yazanın ekranı **kendiliğinden** değişir: reload yok, tıklama yok.
    //
    // İddia "Bana düşenler" bloğuna daraltılır: aynı başlık kapsam akışında da
    // görünüyor ve sayfa genelinde arayan bir iddia iki eşleşme buluyordu.
    const banaDusenler = yazan.locator('[data-test="bana-dusenler"]');
    await expect(banaDusenler.getByText(baslik)).toBeVisible({ timeout: 30_000 });
    // Kuyruk artık ne yapılacağını da söylüyor.
    await expect(
      banaDusenler
        .locator('[data-test="is-satiri"][data-tur="answer"]')
        .filter({ hasText: baslik }),
    ).toBeVisible();
  } finally {
    await yazan.context().close();
    await soran.context().close();
  }
});

test("kullanıcı yazarken tazeleme ertelenir; yazdığı metin silinmez", async ({
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Yazarken ${suffix}`;

  const yazan = await openAs(browser, E2E_USER.email);
  const soran = await openAs(browser, E2E_GM.email);

  try {
    const yol = await writeActivity(yazan, baslik);

    const acilan = await dayanikliGoto(soran, yol);
    expect(acilan?.status()).toBe(200);
    await soran.getByLabel("Soru sor").fill("İlk soru.");
    await soran.getByRole("button", { name: "Soruyu gönder" }).click();
    await expect(soran.getByText("İlk soru.")).toBeVisible();

    // Yazan kişi cevabını yazmaya başlar ve alanda kalır.
    await dayanikliGoto(yazan, yol);
    const cevapAlani = yazan.getByPlaceholder("Cevabınızı yazın");
    await cevapAlani.click();
    await cevapAlani.fill("Yarım kalmış cevabım");

    // Bu sırada ikinci bir olay üretilir (soran konuşmayı kapatır).
    await soran.getByRole("button", { name: "Konuşmayı kapat" }).click();
    await expect(soran.getByText("kapalı")).toBeVisible();

    // Yazanın alanı odakta olduğu için tazeleme ertelenir: metin yerinde kalır.
    await yazan.waitForTimeout(3_000);
    await expect(cevapAlani).toHaveValue("Yarım kalmış cevabım");
  } finally {
    await yazan.context().close();
    await soran.context().close();
  }
});
