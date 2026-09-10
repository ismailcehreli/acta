import { dayanikliGoto } from "./gezinme";
import {
  E2E_ADMIN,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";
import { expect, test, type Page } from "./test-tabani";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("yönetici olmayan kullanıcı feedback ve başlangıca dönüş yönetimini göremez", async ({
  page,
}) => {
  await loginAs(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/feedback?sekme=yonetim");
  await expect(page.getByRole("link", { name: "Yönetim" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Geri bildirim yönetimi" })).toHaveCount(0);

  await dayanikliGoto(page, "/admin/settings/reset");
  await expect(
    page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" }),
  ).toBeVisible();
  await expect(page.getByLabel("Mevcut parolanız")).toHaveCount(0);
});

test("feedback yönetim eylemi yetkili yönetici için gerçek ekranda çalışır", async ({
  page,
  browser,
}) => {
  const workerContext = await browser.newContext();
  const workerPage = await workerContext.newPage();
  const title = `E2E geri bildirim ${Date.now()}`;

  try {
    await loginAs(workerPage, E2E_WORKER.email);
    await dayanikliGoto(workerPage, "/feedback");
    await workerPage.getByLabel("Başlık", { exact: true }).fill(title);
    await workerPage.getByLabel("Açıklama", { exact: true }).fill(
      "Bu kayıt yönetim eyleminin gerçek akışını sınar.",
    );
    await workerPage.getByRole("button", { name: "Geri bildirimi gönder" }).click();
    await expect(workerPage.getByText("Geri bildiriminiz kaydedildi.")).toBeVisible();

    // Aynı kullanıcı URL'yi elle yönetim sekmesine çevirse bile yönetim
    // içeriği oluşmaz; sayfa yetkisi yalnız navigasyon gizlemekten ibaret değil.
    await dayanikliGoto(workerPage, "/feedback?sekme=yonetim");
    await expect(workerPage.getByRole("heading", { name: "Geri bildirim yönetimi" })).toHaveCount(0);

    await loginAs(page, E2E_ADMIN.email);
    await dayanikliGoto(page, "/feedback?sekme=yonetim");
    const card = page
      .locator('[data-test="feedback-yonetim-kaydi"]')
      .filter({ hasText: title });
    await expect(card).toBeVisible();

    await card.getByLabel("Durum").selectOption("RESOLVED");
    await card.getByLabel("Yanıt").fill("Düzeltme yayınlandı.");
    await card.getByRole("button", { name: "Güncelle" }).click();
    await expect(page.getByText("Geri bildirim güncellendi.")).toBeVisible();

    await page.reload();
    const updatedCard = page
      .locator('[data-test="feedback-yonetim-kaydi"]')
      .filter({ hasText: title });
    await expect(updatedCard).toContainText("Çözüldü");
    await expect(updatedCard).toContainText("Düzeltme yayınlandı.");
  } finally {
    await workerContext.close();
  }
});

test("başlangıca dönüş formu doğrulama ve geçerli istek akışını gösterir", async ({
  page,
}) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/settings/reset");

  const fillResetForm = async (currentPassword: string): Promise<void> => {
    await page.getByLabel("Mevcut parolanız").fill(currentPassword);
    await page.getByLabel("Ad soyad").fill("Yeni E2E Başlangıç Yöneticisi");
    await page.getByLabel("E-posta", { exact: true }).fill("yeni-e2e-reset@ornek.test");
    await page.getByLabel("Başlangıç parolası", { exact: true }).fill("yeni-e2e-baslangic-123");
    await page.getByLabel("Başlangıç parolası (tekrar)").fill("yeni-e2e-baslangic-123");
    await page.getByLabel("İşlemi onaylayın").fill("BAŞLANGICA DÖN");
  };

  await fillResetForm("yanlis-parola-123");
  await page.getByRole("button", { name: "Başlangıca dön" }).click();
  await expect(page.getByText("Mevcut parolanız doğrulanamadı.")).toBeVisible();

  await fillResetForm(e2ePassword());
  await page.getByRole("button", { name: "Başlangıca dön" }).click();
  await expect(page.getByText("İstek sıraya alındı.")).toBeVisible();
  await expect(page.getByText("Durum: Bekliyor", { exact: true })).toBeVisible();
  await expect(page.getByText("yeni-e2e-reset@ornek.test")).toBeVisible();
});
