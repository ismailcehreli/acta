import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_PLANNER, E2E_WORKER, e2ePassword } from "./global-setup";

// Profil resmi (Görev 11.5).
//
// Sınanan üç şey: yükleme çalışıyor mu, tür doğrulaması geçilebiliyor mu, ve
// **kapsam dışındaki kişinin resmi sızıyor mu**.

test.describe.configure({ mode: "serial" });

async function profilAc(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Hesap menüsü" }).click();
  await page.getByRole("menuitem", { name: "Profilim" }).click();
  await expect(page).toHaveURL(/\/users\//);
}

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** 1×1 saydam PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("kullanıcı kendi profil resmini yükler ve kaldırır", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await profilAc(page);

  await page
    .getByLabel("Profil resmi dosyası")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Yükle" }).click();

  await expect(page.getByText("Profil resmi güncellendi.")).toBeVisible();

  // Resim gerçekten servis ediliyor: tarayıcı görüntüyü yükleyebilmeli.
  // `naturalWidth` sıfırdan büyükse istek başarılı ve içerik gerçek bir resim.
  // Sayfa **yenilenmeden** görünmeli: kullanıcı "güncellendi" yazısını
  // görüp resmin eski kaldığını görmemeli.
  const gorsel = page.locator('img[src*="/avatar"]').first();
  await expect(gorsel).toHaveCount(1);
  // Asıl kanıt: tarayıcı görüntüyü gerçekten çözebildi mi. Kırık bir resim
  // de sayfada durur; `naturalWidth` yalnız içerik indiğinde sıfırdan büyük.
  await expect
    .poll(() => gorsel.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Resmi kaldır" }).click();
  await expect(page.getByText("Profil resmi kaldırıldı.")).toBeVisible();

  // Kaldırıldıktan sonra resim yok; baş harf rozeti düşer.
  await expect(page.locator('img[src*="/avatar"]')).toHaveCount(0);
});

test("SVG yüklenemez", async ({ page }) => {
  await girisYap(page, E2E_WORKER.email);
  await profilAc(page);

  // Uzantısı ve MIME türü PNG gibi görünen bir SVG: tür içerik imzasından
  // doğrulandığı için geçmemeli.
  await page.getByLabel("Profil resmi dosyası").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await page.getByRole("button", { name: "Yükle" }).click();

  await expect(page.getByText(/Yalnız PNG, JPEG ve WebP/)).toBeVisible();
});

test("kapsam dışındaki kişinin resmi sızmaz", async ({ page, browser }) => {
  // Kalıphane çalışanı resim yükler.
  await girisYap(page, E2E_WORKER.email);
  await profilAc(page);
  const hedefId = page.url().split("/users/")[1]?.split("?")[0] ?? "";

  await page
    .getByLabel("Profil resmi dosyası")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Yükle" }).click();
  await expect(page.getByText("Profil resmi güncellendi.")).toBeVisible();

  // Planlama Müdürü onun yöneticisi değil: profili de resmi de görmemeli.
  const yabanci = await browser.newContext();
  const yabanciSayfa = await yabanci.newPage();
  await girisYap(yabanciSayfa, E2E_PLANNER.email);

  // "Var ama göremezsin" demek kişinin varlığını ele verirdi: 404.
  //
  // Sayfa gezinmesiyle değil **doğrudan istekle** sorulur. Ölçülen şey bir
  // HTTP durum kodu; araya tarayıcının sayfa yükleme kuralını sokmak ölçümü
  // bulandırıyordu: Firefox gövdesiz bir cevaba gezinmeyi tamamlamıyor ve
  // `goto` hiç dönmüyor (22.08.2026). İstek, oturum çerezini bağlamdan
  // aldığı için yetki kontrolü aynen çalışır.
  const cevap = await yabanci.request.get(`/api/users/${hedefId}/avatar`);
  expect(cevap.status()).toBe(404);

  await yabanci.close();
});

test("sistem yöneticisi başkasının resmini değiştirebilir", async ({ page }) => {
  // Ürün sahibi kararı (22.08.2026): uygunsuz resim için müdahale yolu gerek.
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/users");

  await page.getByRole("link", { name: E2E_WORKER.fullName }).first().click();
  await expect(page).toHaveURL(/\/users\//);

  await expect(page.getByLabel("Profil resmi dosyası")).toBeVisible();
});
