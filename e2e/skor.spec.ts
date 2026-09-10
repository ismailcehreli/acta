import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Skor ve takdir (Görev 11.10, 11.11).
//
// **Varsayılan kapalı.** Kapalıyken hiçbir ekranda görünmemeli.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function ayarla(page: Page, etiket: string, ac: boolean) {
  await dayanikliGoto(page, "/admin/settings/scoring");
  // Onay kutusu **rolüyle** aranıyor: açıklama metni etikete karıştığı için
  // `getByLabel` tam eşleşme bulamıyor.
  const kutu = page.getByRole("checkbox", { name: new RegExp(etiket) });
  if (ac) await kutu.check();
  else await kutu.uncheck();
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
  await expect(page.getByText(/ayar güncellendi|değişiklik yok/i)).toBeVisible();
}

test("kapalıyken skor hiçbir yerde görünmez", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Skor sistemi açık", false);

  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/");

  const menu = page.getByRole("navigation", { name: "Ana menü" });
  await expect(menu.getByRole("link", { name: "Skorlar" })).toHaveCount(0);
});

test("açıldığında ekip skorları görünür", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Skor sistemi açık", true);

  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/scores");

  await expect(page.getByRole("heading", { name: "Ekip skorları" })).toBeVisible();
  // Liste kapsam içi: kendi ekibinden biri var.
  await expect(
    page.locator('[data-test="skor-satiri"]').filter({ hasText: E2E_WORKER.fullName }),
  ).toBeVisible();
});

test("profilde skor kırılımı görünür", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();

  const kart = page.locator('[data-test="skor-karti"]');
  await expect(kart).toBeVisible();
  // Tek sayı tarama için, kırılım karar için: ikisi de var.
  await expect(kart.getByText("Düzenli raporlama")).toBeVisible();
  await expect(kart.getByText("Takip disiplini")).toBeVisible();
});

test("kapsam dışı kişinin skoru görünmez", async ({ page }) => {
  // Skor bir toplamdır ve toplam, görülmeyen kaydı ele verir.
  await girisYap(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/scores");

  // Çalışanın ekibi yok: liste boş ya da sayfa erişilebilir ama kimse yok.
  await expect(page.locator('[data-test="skor-satiri"]')).toHaveCount(0);
});

test("takdir yalnız yetkili kullanıcıya gösterilir", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Takdir sistemi açık", true);

  // Kalıphane Müdürü'nün takdir yetkisi yok: düğme çıkmamalı.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/feed?period=all");
  const ilk = page.locator('a[href^="/activities/"]').first();
  if (await ilk.count()) {
    await ilk.click();
    await expect(page.getByRole("button", { name: /Takdir et/ })).toHaveCount(0);
  }
});

test("sıralama kapalıyken bağlantı yok, açıkken çalışır", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Sıralama sekmesi açık", false);

  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/scores");
  await expect(page.getByRole("link", { name: /sırala/ })).toHaveCount(0);

  await girisYap(page, E2E_ADMIN.email);
  await ayarla(page, "Sıralama sekmesi açık", true);

  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/scores");

  // Varsayılan **alfabetik**; skora göre sıralamak bir tıkla mümkün.
  const bag = page.getByRole("link", { name: "Skora göre sırala" });
  await expect(bag).toBeVisible();
  await bag.click();
  await expect(page).toHaveURL(/siralama=skor/);
  await expect(page.getByRole("link", { name: "Alfabetik sırala" })).toBeVisible();
});

// Ağırlıklar **ayardır** (denetim 23.08.2026, bulgu 8): formülü
// değiştirmek için dağıtım gerekmemeli. Bu test panelin gerçekten okunup
// uygulandığını uçtan uca ölçüyor — ekrandan kaydedilen değer, hesaba giriyor.
async function agirlikYaz(page: Page, degerler: Record<string, string>) {
  await dayanikliGoto(page, "/admin/settings/scoring");
  for (const [ad, deger] of Object.entries(degerler)) {
    await page.locator(`input[name="${ad}"]`).fill(deger);
  }
  await page.getByRole("button", { name: "Ayarları kaydet" }).click();
}

test("toplamı 100 etmeyen ağırlık bileşimi panelde reddedilir", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);

  await agirlikYaz(page, { scoring_weight_regularity: "70" });

  // Sunucu reddediyor ve gerekçesini profil adıyla söylüyor.
  await expect(page.getByText(/ağırlıklar toplamı 100 olmalı/i)).toBeVisible();

  // Hiçbiri yazılmamış olmalı: yarısı yeni yarısı eski bir formül, hiçbir
  // profilde 100 etmeyen bir skor üretirdi.
  await dayanikliGoto(page, "/admin/settings/scoring");
  await expect(page.locator('input[name="scoring_weight_regularity"]')).toHaveValue("60");
});

test("panelden değiştirilen ağırlık skor kırılımını değiştirir", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await agirlikYaz(page, {
    scoring_weight_regularity: "60",
    scoring_weight_acceptance: "30",
    scoring_weight_approval: "30",
    scoring_weight_follow_up: "10",
  });

  // Müdür profili birimin onay bayrağından bağımsızdır: yönetici her zaman
  // "yönetici" profilini alır ve kırılımında **onay süresi** boyutu vardır.
  await girisYap(page, E2E_USER.email);
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();
  const kart = page.locator('[data-test="skor-karti"]');
  await expect(kart.getByText("Onay süresi")).toBeVisible();

  // Onay süresi ağırlığı sıfırlanıyor; toplam yine 100 (90 + 0 + 10).
  await girisYap(page, E2E_ADMIN.email);
  await agirlikYaz(page, {
    scoring_weight_regularity: "90",
    scoring_weight_acceptance: "0",
    scoring_weight_approval: "0",
    scoring_weight_follow_up: "10",
  });
  await expect(page.getByText(/ayar güncellendi/i)).toBeVisible();

  // Ölçmeyen boyut kırılımdan **düşüyor**; ağırlığı düzenliliğe eklendi.
  await girisYap(page, E2E_USER.email);
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();
  await expect(kart.getByText("Onay süresi")).toHaveCount(0);
  await expect(kart.getByText("Düzenli raporlama")).toBeVisible();

  // Varsayılanlara dönülüyor ki diğer testler etkilenmesin.
  await girisYap(page, E2E_ADMIN.email);
  await agirlikYaz(page, {
    scoring_weight_regularity: "60",
    scoring_weight_acceptance: "30",
    scoring_weight_approval: "30",
    scoring_weight_follow_up: "10",
  });
  await expect(page.getByText(/ayar güncellendi/i)).toBeVisible();
});
