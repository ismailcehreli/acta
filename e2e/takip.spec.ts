import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Takip maddeleri (§11).
//
// Sınanan şey: konu açık kalıyor işareti gerçekten bir kayıt üretiyor mu,
// kapatırken not zorunlu mu, ve **göremeyen kişiye görünmüyor mu**.

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

async function faaliyetYaz(page: Page, baslik: string, takipAc: boolean) {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill(`${baslik} için açıklama.`);
  if (takipAc) {
    await page.getByRole("checkbox", { name: "Bu konu açık kalsın" }).check();
  }
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);
}

test("tek tıkla takip açılır ve listede görünür", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Takip denemesi ${suffix}`;

  const calisan = await openAs(browser, E2E_WORKER.email);

  try {
    await faaliyetYaz(calisan, baslik, true);

    await dayanikliGoto(calisan, "/follow-ups");
    const satir = calisan
      .locator('[data-test="takip-satiri"]')
      .filter({ hasText: baslik });
    await expect(satir).toBeVisible();
    await expect(satir).toContainText("Kalıphane Çalışanı");
  } finally {
    await calisan.context().close();
  }
});

test("kapatmak için not zorunlu; not kayıtta kalıyor", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Kapanacak takip ${suffix}`;

  const calisan = await openAs(browser, E2E_WORKER.email);

  try {
    await faaliyetYaz(calisan, baslik, true);

    await dayanikliGoto(calisan, "/follow-ups");
    await calisan
      .locator('[data-test="takip-satiri"]')
      .filter({ hasText: baslik })
      .getByRole("link")
      .click();
    await expect(calisan).toHaveURL(/\/activities\/[0-9a-f-]{36}$/);

    const kart = calisan.locator('[data-test="takip-karti"]');
    await expect(kart).toBeVisible();
    await kart.getByRole("button", { name: "Takibi kapat" }).click();

    const form = calisan.locator('[data-test="takip-kapat-formu"]');
    // Not boşken tarayıcı zaten göndermez; alan `required`.
    await expect(form.getByLabel("Kapanış notu")).toHaveAttribute("required", "");

    await form.getByLabel("Kapanış notu").fill("Parça geldi, takıldı.");
    await form.getByRole("button", { name: "Kapat" }).click();

    // Kart kapandı, kapanış notu kayıtta.
    await expect(calisan.locator('[data-test="takip-karti"]')).toHaveCount(0);
    await expect(calisan.locator('[data-test="takip-kapali"]')).toContainText(
      "Parça geldi, takıldı.",
    );

    // Listeden düştü.
    await dayanikliGoto(calisan, "/follow-ups");
    await expect(
      calisan.locator('[data-test="takip-satiri"]').filter({ hasText: baslik }),
    ).toHaveCount(0);
  } finally {
    await calisan.context().close();
  }
});

test("kapsam dışındaki kişi takip maddesini göremez", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Gizli takip ${suffix}`;

  const calisan = await openAs(browser, E2E_WORKER.email);
  const akran = await openAs(browser, E2E_PLANNER.email);
  const mudur = await openAs(browser, E2E_USER.email);

  try {
    await faaliyetYaz(calisan, baslik, true);

    // Başka daldaki müdür ne başlığı ne "sonraki adım" metnini görür.
    await dayanikliGoto(akran, "/follow-ups");
    await expect(akran.getByText(baslik)).toHaveCount(0);

    // Kendi yöneticisi görür.
    await dayanikliGoto(mudur, "/follow-ups");
    await expect(
      mudur.locator('[data-test="takip-satiri"]').filter({ hasText: baslik }),
    ).toBeVisible();
  } finally {
    for (const page of [calisan, akran, mudur]) await page.context().close();
  }
});
