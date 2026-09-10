import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_PLANNER, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Görev 5.2 (§16.2): arama, görünürlük kapsamıyla sınırlıdır. Kapsam dışı bir
// kaydın aramada görünmediği burada gerçek ekranla kanıtlanır.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  // Girişli kullanıcı /login adresinden ana ekrana yönlendirilir; önce çerez
  // temizlenir ki aynı sayfada kullanıcı değiştirilebilsin.
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function writeActivity(page: Page, title: string, description: string) {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(title);
  await page.getByLabel("Açıklama").fill(description);
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);
}

test("yönetici kendi kapsamındaki kaydı arayarak bulur", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Kalıp sökümü ${suffix}`;

  await loginAs(page, E2E_WORKER.email);
  await writeActivity(
    page,
    baslik,
    `Presteki kalıplar söküldü ve temizlendi. Kod ${suffix}.`,
  );

  // Üstü (Kalıphane Müdürü) arar: Türkçe ek almış kelimeyle eşleşmeli.
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/search");
  await page.getByLabel("Ara").fill(`kalıp ${suffix}`);
  await page.getByRole("button", { name: "Ara" }).click();

  await expect(page.getByRole("link", { name: baslik })).toBeVisible();
  // Eşleşen yer özet içinde işaretlenir.
  await expect(page.locator("mark").first()).toBeVisible();
});

test("akranın kaydı aramada hiç görünmez", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Planlama notu ${suffix}`;

  // Planlama Müdürü kendi departmanında kayıt yazar.
  await loginAs(page, E2E_PLANNER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page
    .getByLabel("Açıklama")
    .fill(`Haftalık üretim planı gözden geçirildi. Kod ${suffix}.`);
  await page
    .getByRole("checkbox", { name: /^Planlama( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  // Önce kaydın gerçekten aranabilir olduğu gösterilir: aksi hâlde aşağıdaki
  // "bulunamadı" iddiası, kayıt hiç oluşmadığı için de geçerdi.
  await dayanikliGoto(page, "/search");
  await page.getByLabel("Ara").fill(suffix);
  await page.getByRole("button", { name: "Ara" }).click();
  await expect(page.getByRole("link", { name: baslik })).toBeVisible();

  // Kalıphane Müdürü akranıdır; arasa da bulamaz (§8.1).
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/search");
  await page.getByLabel("Ara").fill(suffix);
  await page.getByRole("button", { name: "Ara" }).click();

  await expect(page.getByText("sonuç bulunamadı")).toBeVisible();
  await expect(page.getByRole("link", { name: baslik })).toHaveCount(0);
});

test("oturumsuz kullanıcı arama ekranını açamaz", async ({ page }) => {
  await dayanikliGoto(page, "/search?q=kalıp");

  await expect(page).toHaveURL(/\/login$/);
});

test("aramada süzgeç sonucu daraltır ve kelime kaybolmaz", async ({ page }) => {
  await loginAs(page, E2E_USER.email);

  const suffix = String(Date.now()).slice(-6);
  const baslik = `Süzgeç denemesi ${suffix}`;

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Süzgeç için örnek kayıt.");
  // Yöneticiye departman seçili gelmiyor (§5.4); en az biri zorunlu.
  await page
    .getByRole("checkbox", { name: /^Kalıphane( \(kendi biriminiz\))?$/ })
    .check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  await dayanikliGoto(page, `/search?q=${encodeURIComponent(suffix)}`);
  await expect(page.getByText(baslik).first()).toBeVisible();

  // Kapsam akışındaki süzgecin aynısı burada da var (Görev 10.9).
  await page.getByLabel("Yazan departman").selectOption({ label: "Planlama" });
  await page.getByRole("button", { name: "Ara" }).click();

  // Arama kelimesi kayboldu mu? Kaybolsaydı kullanıcı bomboş bir sayfaya
  // düşer ve sebebini anlamazdı.
  await expect(page.getByLabel("Ara")).toHaveValue(suffix);
  await expect(page.getByText(baslik)).toHaveCount(0);

  // Süzgeci temizleyince kayıt geri gelir.
  await page.getByRole("link", { name: "Süzgeci temizle" }).click();
  await expect(page.getByText(baslik).first()).toBeVisible();
});
