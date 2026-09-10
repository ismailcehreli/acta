import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_ADMIN,
  E2E_DYE_MANAGER,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2ePassword,
} from "./global-setup";

// Bölüm müdürünün işlevsel yetkisi (Görev 11.7).
//
// Sınanan asıl şey **sınırın kendisi**. Ekranın bir düğmeyi gizlemesi
// güvenlik değildir; testler sunucunun ne yaptığına bakıyor.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("müdür kullanıcı yönetimini açabilir", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/users");

  await expect(
    page.getByRole("heading", { name: "Kullanıcılar" }).first(),
  ).toBeVisible();
});

test("müdürün listesi kendi ağacıyla sınırlı", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/users");

  // Kullanıcı **bağlantısı** aranıyor: "Sistem Yöneticisi" metni ekranda rol
  // etiketi olarak da geçiyor ve düz metin araması ikisini ayırt edemiyor.
  const satir = (ad: string) => page.getByRole("link", { name: ad });

  // Kendi biriminden biri görünür.
  await expect(satir(E2E_WORKER.fullName).first()).toBeVisible();

  // Kardeş birimdeki müdür ve sistem yöneticisi görünmez.
  await expect(satir(E2E_PLANNER.fullName)).toHaveCount(0);
  await expect(satir(E2E_ADMIN.fullName)).toHaveCount(0);
});

test("müdüre yetki kutuları ve parola belirleme gösterilmez", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/users");

  await expect(
    page.getByText("yetkilerini yalnız sistem yöneticisi verebilir"),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Sistem yöneticisi" })).toHaveCount(0);

  // Parola belirleme yerine sıfırlama bağlantısı.
  await expect(
    page.getByRole("button", { name: "Sıfırlama bağlantısı gönder" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Parola", exact: true })).toHaveCount(0);

  // Düzenleme formunda müdüre yalnız ad ve unvan açık. E-posta ve birim
  // alanları buradan kaldırıldı: müdür astının adresini kendi adresine
  // çevirip şifre sıfırlama tetikleyebiliyordu ve bağlantı ona gidiyordu
  // (denetim 23.08.2026, bulgu 4). Asıl kural sunucuda
  // (`updateUserByManager`, `tests/users/mudur-yetkisi.test.ts`); burada
  // sınanan şey ekranın aynı şeyi söylediği.
  await page.getByRole("button", { name: "Düzenle" }).first().click();
  // Ekleme formunda e-posta ve birim **olmalı** (müdür personel ekleyebilir);
  // sınanan şey yalnız düzenleme formu.
  const duzenleme = page.locator('[data-test="kullanici-duzenleme"]');
  await expect(duzenleme.getByLabel("Ad soyad")).toBeVisible();
  await expect(duzenleme.getByLabel("Unvan")).toBeVisible();
  await expect(duzenleme.getByLabel("E-posta", { exact: true })).toHaveCount(0);
  await expect(duzenleme.getByLabel("Birim", { exact: true })).toHaveCount(0);
  await expect(
    duzenleme.getByRole("checkbox", { name: "Günlük faaliyet yazar" }),
  ).toHaveCount(0);
});

test("müdür kendi ağacına personel ekler", async ({ page }) => {
  const eposta = `yeni-${String(Date.now()).slice(-6)}@ornek.test`;

  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/users");

  await page.getByLabel("Ad soyad").fill("Müdürün Eklediği");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Unvan").fill("Kalıpçı");

  // **Müdür parola belirleyemez** (tasarım, Paket F): alan ekranda yok ve
  // sunucu da kabul etmiyor. Parolayı kişi kendi adresine giden bağlantıyla
  // kurar. Müdürün bildiği parola, denetim izindeki "bu kaydı kim yazdı"
  // cevabını zayıflatırdı.
  await expect(page.getByLabel("Başlangıç parolası")).toHaveCount(0);

  // Birim seçici müdürün ağacıyla sınırlı: seçenekler yalnız kendi ağacından.
  const birimSecici = page.getByLabel("Birim", { exact: true });
  const secenekler = await birimSecici.locator("option").allTextContents();
  expect(secenekler.join(" ")).toContain("Kalıphane");
  expect(secenekler.join(" ")).not.toContain("Planlama");

  // İlk seçenek "Birim seçin" yer tutucusu; gerçek birim ondan sonra geliyor.
  await birimSecici.selectOption({ index: 1 });

  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();

  await expect(page.locator("#kullanici-basarili")).toContainText("eklendi");
  await expect(page.getByRole("cell", { name: eposta })).toBeVisible();

  // Unvan gerçekten saklanmalı: müdüre verilen iki alandan biri o.
  await expect(page.getByRole("cell", { name: "Kalıpçı" }).first()).toBeVisible();
});

test("müdür kardeş birimdeki kullanıcıyı düzenleyemez", async ({ page }) => {
  // Ekranda o kullanıcı hiç görünmüyor; sınanan şey **sunucunun** kararı.
  // Planlama Müdürü'nün kimliğini sistem yöneticisi listesinden alıyoruz.
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/users?q=" + encodeURIComponent(E2E_PLANNER.fullName));
  const link = page.locator('a[href^="/users/"]').first();
  const href = await link.getAttribute("href");
  const yabanciId = href?.split("/users/")[1] ?? "";
  expect(yabanciId).not.toBe("");

  // Kalıphane Müdürü olarak o kullanıcının profiline erişemez.
  await girisYap(page, E2E_USER.email);
  const cevap = await dayanikliGoto(page, `/users/${yabanciId}`);
  expect(cevap?.status()).toBe(404);
});

test("boyahane müdürü kalıphane çalışanını göremez", async ({ page }) => {
  await girisYap(page, E2E_DYE_MANAGER.email);
  await dayanikliGoto(page, "/admin/users");

  await expect(page.getByRole("link", { name: E2E_WORKER.fullName })).toHaveCount(
    0,
  );
});

test("sistem yöneticisinde yetki kutuları ve parola belirleme duruyor", async ({
  page,
}) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/users");

  await expect(
    page.getByRole("checkbox", { name: "Sistem yöneticisi" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Parola", exact: true }).first(),
  ).toBeVisible();
});
