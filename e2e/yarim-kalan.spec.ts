import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

// Yarım kalmış metin koruması (Görev 10.2).
//
// Sınanan şey: kullanıcı yazarken sayfadan çıkarsa metin kaybolmuyor, ama
// kayıt tamamlandıktan sonra da geri teklif edilmiyor — teklif edilseydi
// mükerrer faaliyet üretirdi.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("yazıp çıkan kullanıcı metnini geri getirir", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  const metin = `Yarım kalan ${String(Date.now()).slice(-6)}`;

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(metin);
  await page.getByLabel("Açıklama").fill("Bu metin kaybolmamalı.");
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();

  // Kaydetmeden çık: telefon geldi, sekme kapandı, yanlış bağlantıya basıldı.
  await dayanikliGoto(page, "/");
  await dayanikliGoto(page, "/activities/new");

  const serit = page.locator('[data-test="yarim-kalan"]');
  await expect(serit).toBeVisible();

  // **Kendiliğinden dolmaz**; kullanıcı ister.
  await expect(page.getByLabel("Başlık")).toHaveValue("");

  await serit.getByRole("button", { name: "Geri getir" }).click();

  await expect(page.getByLabel("Başlık")).toHaveValue(metin);
  await expect(page.getByLabel("Açıklama")).toHaveValue("Bu metin kaybolmamalı.");
  // Departman seçimi de geri gelir.
  await expect(
    page.getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ }),
  ).toBeChecked();
  // Şerit iş bitince kaybolur.
  await expect(serit).toHaveCount(0);
});

test("kayıt tamamlanınca metin bir daha teklif edilmez", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  const metin = `Tamamlanan ${String(Date.now()).slice(-6)}`;

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(metin);
  await page.getByLabel("Açıklama").fill("Bu kayıt tamamlanacak.");
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  await dayanikliGoto(page, "/activities/new");

  // Teklif edilseydi kullanıcı "geri getir" deyip aynı kaydı ikinci kez
  // yazardı.
  await expect(page.locator('[data-test="yarim-kalan"]')).toHaveCount(0);
});

test("silinen metin bir daha teklif edilmez", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Vazgeçilen metin");
  await page.getByLabel("Açıklama").fill("Bunu istemiyorum.");

  await dayanikliGoto(page, "/activities/new");
  const serit = page.locator('[data-test="yarim-kalan"]');
  await expect(serit).toBeVisible();
  await serit.getByRole("button", { name: "Sil" }).click();

  await dayanikliGoto(page, "/activities/new");
  await expect(page.locator('[data-test="yarim-kalan"]')).toHaveCount(0);
});

test("başkasının yarım metni teklif edilmez", async ({ page }) => {
  // Ortak kullanılan bir tarayıcıda birinin yazdığı metin diğerine
  // gösterilseydi içerik sızıntısı olurdu.
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Çalışanın gizli metni");
  await page.getByLabel("Açıklama").fill("Bunu kimse görmemeli.");
  await page.waitForTimeout(700);

  await girisYap(page, E2E_PLANNER.email);
  await dayanikliGoto(page, "/activities/new");

  await expect(page.locator('[data-test="yarim-kalan"]')).toHaveCount(0);
  await expect(page.getByText("Çalışanın gizli metni")).toHaveCount(0);
});
