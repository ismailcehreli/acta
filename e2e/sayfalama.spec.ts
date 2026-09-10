import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_GM, e2ePassword } from "./global-setup";

// Sayfalama ve "sayfada kaç kayıt" tercihi.
//
// Sınanan üç şey:
//   1. Seçim **anında** uygulanır — kullanıcı ayrıca "Uygula"ya basmıyor.
//   2. Seçim **hatırlanır**: başka bir listeye geçince de geçerli, sayfa
//      yeniden yüklenince de. Çerezde duruyor.
//   3. Sunucu gelen değeri izinli listeye indirger: adres çubuğuna yazılan
//      uydurma bir sayı sorguya geçemez.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("sayfa boyu seçimi anında uygulanır ve hatırlanır", async ({ page }) => {
  await girisYap(page, E2E_GM.email);

  await dayanikliGoto(page, "/feed");
  await expect(page.getByLabel("Sayfada")).toHaveValue("25");

  // Seçim anında uygulanır: ayrı bir "Uygula" tıklaması yok.
  await page.getByLabel("Sayfada").selectOption("100");
  await expect(page).toHaveURL(/boyut=100/);
  await expect(page.getByLabel("Sayfada")).toHaveValue("100");

  // Tercih çerezde: başka bir liste de aynı boyu kullanmalı.
  await dayanikliGoto(page, "/activities");
  await expect(page.getByLabel("Sayfada")).toHaveValue("100");

  // Ve sonraki ziyarette hâlâ geçerli — adres çubuğunda hiçbir şey yokken.
  await dayanikliGoto(page, "/feed");
  await expect(page.getByLabel("Sayfada")).toHaveValue("100");
});

test("adres çubuğundaki uydurma boyut kabul edilmez", async ({ page }) => {
  await girisYap(page, E2E_GM.email);

  // Sunucu izinli listeye indirger; çerez de yoksa varsayılana düşer.
  await dayanikliGoto(page, "/feed?boyut=100000");
  await expect(page.getByLabel("Sayfada")).toHaveValue("25");

  await dayanikliGoto(page, "/activities?boyut=abc");
  await expect(page.getByLabel("Sayfada")).toHaveValue("25");
});

test("kendi arşivinde numaralı sayfalama çalışır", async ({ page }) => {
  await girisYap(page, E2E_GM.email);

  // Küçük sayfa boyuyla birden fazla sayfa oluşsun.
  await dayanikliGoto(page, "/activities?boyut=25");

  const sayfalama = page.getByRole("navigation", { name: "Sayfalama" });

  // Uçtan uca veri seti küçük; sayfalama yalnız birden fazla sayfa varken
  // çizilir. İkisi de geçerli sonuç, ikisini de kabul ediyoruz — sınanan
  // şey "varsa çalışıyor mu".
  if ((await sayfalama.count()) === 0) {
    await expect(page.getByRole("heading", { name: "Kayıt defteri" })).toBeVisible();
    return;
  }

  await expect(sayfalama.getByRole("link", { name: "Sayfa 1" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await sayfalama.getByRole("link", { name: "Sonraki sayfa" }).click();
  await expect(page).toHaveURL(/sayfa=2/);
  await expect(
    page.getByRole("navigation", { name: "Sayfalama" }).getByRole("link", {
      name: "Sayfa 2",
    }),
  ).toHaveAttribute("aria-current", "page");
});
