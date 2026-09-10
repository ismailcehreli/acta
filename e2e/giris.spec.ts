import { dayanikliGoto } from "./gezinme";
import { expect, test } from "./test-tabani";

import { E2E_USER, e2ePassword } from "./global-setup";

test.describe.configure({ mode: "serial" });

test("oturumsuz kullanıcı giriş sayfasına yönlendirilir", async ({ page }) => {
  await dayanikliGoto(page, "/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("E-posta", { exact: true })).toBeVisible();
});

// Denetim (17.08.2026, bulgu 13): önceki test yalnızca kayıtlı hesaba
// yanlış parola gönderiyordu, dolayısıyla "kullanıcıyı ele vermiyor" iddiasını
// kanıtlamıyordu. Kanıt, farklı hesap durumlarının **aynı** cevabı vermesidir.
test("kayıtlı ve kayıtsız hesap aynı hata metnini alır", async ({ page }) => {
  async function errorTextFor(email: string): Promise<string> {
    await dayanikliGoto(page, "/login");
    await page.getByLabel("E-posta", { exact: true }).fill(email);
    await page.getByLabel("Parola", { exact: true }).fill("kesinlikle-yanlis-parola");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    return (await page.locator("#giris-hatasi").textContent()) ?? "";
  }

  const registered = await errorTextFor(E2E_USER.email);
  const unknown = await errorTextFor("hic-kayitli-olmayan@ornek.test");

  expect(registered).toContain("E-posta veya parola hatalı.");
  expect(unknown).toBe(registered);
  await expect(page).toHaveURL(/\/login$/);
});

test("doğru parolayla giriş yapılır ve çıkış oturumu kapatır", async ({
  page,
  context,
  browser,
}) => {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(E2E_USER.email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("banner").getByText(E2E_USER.fullName),
  ).toBeVisible();

  // Oturum çerezinin bir kopyası alınır: çıkışın yalnızca tarayıcıdaki çerezi
  // silmediğini, sunucudaki oturumu da iptal ettiğini kanıtlamak için.
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name === "faaliyet_oturum");
  expect(sessionCookie).toBeDefined();

  // Çıkış hesap menüsünün içinde: ad artık doğrudan parola ekranına gitmiyor.
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Çıkış yap" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Çıkıştan sonra korumalı sayfa bu tarayıcıda açılmaz.
  await dayanikliGoto(page, "/");
  await expect(page).toHaveURL(/\/login$/);

  // Kopyalanan çerez başka bir tarayıcı bağlamında da işe yaramaz. Sunucu
  // tarafındaki iptal kaldırılsaydı bu adım geçerdi ve test sessizce
  // değersizleşirdi.
  const stolen = await browser.newContext();
  try {
    await stolen.addCookies([sessionCookie!]);
    const stolenPage = await stolen.newPage();
    await dayanikliGoto(stolenPage, "/");
    await expect(stolenPage).toHaveURL(/\/login$/);
  } finally {
    await stolen.close();
  }
});

// "Beni hatırla" (21.08.2026).
//
// Sınanan iki şey: kutunun ne söylediği ve ayarla kapatılabildiği. Süre
// uzatmasının kendisi birim testinde ölçülüyor; burada kullanıcının gördüğü
// yüz sınanıyor.
test("beni hatırla kutusu ne yaptığını söyler", async ({ page }) => {
  await dayanikliGoto(page, "/login");

  const kutu = page.getByRole("checkbox", { name: "Beni hatırla" });
  await expect(kutu).toBeVisible();

  // Belirsiz bir söz değil, sayılı bir taahhüt olmalı.
  await expect(page.getByText(/\d+ gün boyunca yeniden parola sorulmaz/)).toBeVisible();
  // Ortak bilgisayar uyarısı da orada.
  await expect(page.getByText(/Ortak bir bilgisayardaysanız/)).toBeVisible();
});

test("beni hatırla işaretli girişte oturum açılır", async ({ page }) => {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(E2E_USER.email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("checkbox", { name: "Beni hatırla" }).check();
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/$/);

  // Çerez oturumla aynı ömrü taşımalı: uzun oturum kısa çerezle işe yaramaz.
  const cerez = (await page.context().cookies()).find(
    (c) => c.name === "faaliyet_oturum",
  );
  expect(cerez).toBeDefined();

  const kalanGun = (cerez!.expires * 1000 - Date.now()) / 86_400_000;
  expect(kalanGun).toBeGreaterThan(7);
});
