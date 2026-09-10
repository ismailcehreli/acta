import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_GM,
  E2E_USER,
  e2ePassword,
} from "./global-setup";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("rapor ekranı yetkili yöneticiye anlamlı kapsam gösterir", async ({ page }) => {
  await loginAs(page, E2E_CHAIRMAN.email);

  const menu = page.getByRole("navigation", { name: "Ana menü" });
  await expect(menu.getByRole("link", { name: "Raporlar" })).toBeVisible();

  await dayanikliGoto(page, "/reports");
  await expect(page.getByRole("heading", { name: "Raporlar", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Faaliyet özeti" })).toBeVisible();
  await expect(page.getByText(/Kapsam: Şirket ve alt birimleri/)).toBeVisible();
  await expect(page.getByText("Bu ne anlatır?", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /Kalıphane/ })).toHaveCount(1);
});

test("rapor kapsamı ara yöneticiye bağlı dalı gösterir", async ({ page }) => {
  await loginAs(page, E2E_GM.email);
  await dayanikliGoto(page, "/reports");

  await expect(page.getByText(/Kapsam: Genel Müdürlük ve alt birimleri/)).toBeVisible();
  await expect(page.getByRole("option", { name: /Planlama/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Skor ve takdir" })).toHaveCount(0);
});

test("yetkisiz kullanıcı ve sistem yöneticisi rapor ekranını açamaz", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await expect(page.getByRole("link", { name: "Raporlar" })).toHaveCount(0);
  await dayanikliGoto(page, "/reports");
  await expect(page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" })).toBeVisible();

  await loginAs(page, E2E_ADMIN.email);
  await expect(page.getByRole("link", { name: "Raporlar" })).toHaveCount(0);
  await dayanikliGoto(page, "/reports");
  await expect(page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" })).toBeVisible();
});
