import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, e2ePassword } from "./global-setup";

// Parola değiştirme akışı (§15.3). Kendi hesabıyla değil, koşu içinde açılan
// geçici bir hesapla çalışır: paylaşılan test hesabının parolasını değiştirmek
// diğer testleri kırardı.
test.describe.configure({ mode: "serial" });

/** Giriş dener; başarıyı beklemez (hata senaryolarında kullanılır). */
async function tryLogin(page: Page, email: string, password: string) {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

/** Giriş yapar ve ana sayfaya ulaşıldığını doğrular. */
async function loginAs(page: Page, email: string, password: string) {
  await tryLogin(page, email, password);
  await expect(page).toHaveURL(/\/$/);
}

test("kullanıcı parolasını değiştirir; eski parola geçersizleşir", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `parola-${suffix}@ornek.test`;
  const eskiParola = `eski-parola-${suffix}`;
  const yeniParola = `yeni-parola-${suffix}`;

  // Yönetici geçici bir hesap açar.
  await loginAs(page, E2E_ADMIN.email, e2ePassword());
  await dayanikliGoto(page, "/admin/users");
  await page.getByLabel("Ad soyad").fill(`Parola Deneme ${suffix}`);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Birim", { exact: true }).selectOption({ label: "Şirket" });
  await page.getByLabel("Başlangıç parolası").fill(eskiParola);
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  const oturum = await browser.newContext();
  try {
    const kullanici = await oturum.newPage();
    await loginAs(kullanici, email, eskiParola);

    // Yanlış mevcut parola kabul edilmez.
    await dayanikliGoto(kullanici, "/parola");
    await kullanici.getByLabel("Mevcut parola").fill("kesinlikle-yanlis");
    await kullanici.getByLabel("Yeni parola", { exact: true }).fill(yeniParola);
    await kullanici.getByLabel("Yeni parola (tekrar)").fill(yeniParola);
    await kullanici.getByRole("button", { name: "Parolayı değiştir" }).click();
    await expect(kullanici.locator("#parola-hatasi")).toContainText(
      "Mevcut parolanız hatalı",
    );

    // Tekrar alanı eşleşmezse de kabul edilmez.
    await kullanici.getByLabel("Mevcut parola").fill(eskiParola);
    await kullanici.getByLabel("Yeni parola", { exact: true }).fill(yeniParola);
    await kullanici.getByLabel("Yeni parola (tekrar)").fill("baska-bir-parola");
    await kullanici.getByRole("button", { name: "Parolayı değiştir" }).click();
    await expect(kullanici.locator("#parola-hatasi")).toContainText(
      "eşleşmiyor",
    );

    // Doğru bilgilerle değişim: oturum kapanır, giriş ekranına düşülür.
    await kullanici.getByLabel("Mevcut parola").fill(eskiParola);
    await kullanici.getByLabel("Yeni parola", { exact: true }).fill(yeniParola);
    await kullanici.getByLabel("Yeni parola (tekrar)").fill(yeniParola);
    await kullanici.getByRole("button", { name: "Parolayı değiştir" }).click();

    await expect(kullanici).toHaveURL(/\/login/);
    await expect(kullanici.locator("#parola-degisti")).toBeVisible();

    // Eski parola artık çalışmaz.
    await tryLogin(kullanici, email, eskiParola);
    await expect(kullanici.locator("#giris-hatasi")).toContainText(
      "E-posta veya parola hatalı.",
    );

    // Yeni parola çalışır.
    await loginAs(kullanici, email, yeniParola);
  } finally {
    await oturum.close();
  }
});

test("oturumsuz kullanıcı parola ekranını açamaz", async ({ page }) => {
  await dayanikliGoto(page, "/parola");

  await expect(page).toHaveURL(/\/login$/);
});
