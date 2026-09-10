import { PrismaClient } from "@prisma/client";
import { dayanikliGoto } from "./gezinme";
import { expect, test } from "./test-tabani";

import { E2E_ADMIN, e2ePassword } from "./global-setup";

// Görev 5.5 (§15.3): tek kullanımlık ve süreli belirteçle sıfırlama.
//
// Belirteç e-postayla gidiyor; uçtan uca koşuda posta kutusu yok, bu yüzden
// bildirim kuyruğundan okunuyor. Sınanan şey belirtecin **taşınma yolu** değil,
// sıfırlama akışının kendisi: bağlantı çalışıyor mu, ikinci kez çalışmıyor mu,
// eski parola geçersizleşiyor mu.
test.describe.configure({ mode: "serial" });

function db(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: process.env.E2E_DATABASE_URL } },
  });
}

async function belirtecAl(email: string): Promise<string> {
  const prisma = db();
  try {
    const kayit = await prisma.notificationQueue.findFirstOrThrow({
      where: { eventType: "password_reset", user: { email } },
      orderBy: { createdAt: "desc" },
    });
    return (kayit.payload as { token: string }).token;
  } finally {
    await prisma.$disconnect();
  }
}

test("kullanıcı parolasını sıfırlar; bağlantı ikinci kez çalışmaz", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `sifirlama-${suffix}@ornek.test`;
  const ilkParola = `baslangic-${suffix}-parola`;
  const yeniParola = `sifirlanan-${suffix}-parola`;

  // Test kendi kullanıcısını açar: kurulum hesaplarının parolasını değiştirmek
  // diğer uçtan uca testleri bozardı.
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);

  await dayanikliGoto(page, "/admin/users");
  await page.getByLabel("Ad soyad").fill(`Sıfırlama Denemesi ${suffix}`);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page
    .getByLabel("Birim", { exact: true })
    .selectOption({ label: "Şirket" });
  await page.getByLabel("Başlangıç parolası").fill(ilkParola);
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  await page.context().clearCookies();

  // Giriş ekranından sıfırlama istenir.
  await dayanikliGoto(page, "/login");
  await page.getByRole("link", { name: "Parolamı unuttum" }).click();
  await expect(page).toHaveURL(/\/reset$/);

  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Sıfırlama bağlantısı gönder" }).click();
  await expect(page.getByText("Bu adres kayıtlıysa")).toBeVisible();

  // Belirteç kuyruğa yazıldı; e-postadaki bağlantı bu.
  const token = await belirtecAl(email);
  expect(token.length).toBeGreaterThan(20);

  await dayanikliGoto(page, `/reset/${encodeURIComponent(token)}`);
  await page.getByLabel("Yeni parola", { exact: true }).fill(yeniParola);
  await page.getByLabel("Yeni parola (tekrar)").fill(yeniParola);
  await page.getByRole("button", { name: "Parolayı değiştir" }).click();

  await expect(page.getByText("Parolanız değiştirildi")).toBeVisible();

  // Yeni parolayla giriş yapılabilir.
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(yeniParola);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Aynı bağlantı ikinci kez çalışmaz.
  await page.context().clearCookies();
  await dayanikliGoto(page, `/reset/${encodeURIComponent(token)}`);
  await page.getByLabel("Yeni parola", { exact: true }).fill("baska-parola-9876");
  await page.getByLabel("Yeni parola (tekrar)").fill("baska-parola-9876");
  await page.getByRole("button", { name: "Parolayı değiştir" }).click();

  await expect(page.getByText("Bu bağlantı kullanılmış")).toBeVisible();

  // İkinci deneme parolayı değiştirmemiş olmalı.
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(yeniParola);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("kayıtsız e-posta aynı cevabı alır", async ({ page }) => {
  await dayanikliGoto(page, "/reset");
  await page.getByLabel("E-posta", { exact: true }).fill("hic-kayitli-degil@ornek.test");
  await page.getByRole("button", { name: "Sıfırlama bağlantısı gönder" }).click();

  // Kayıtlı adresle **aynı** metin: kimin kayıtlı olduğu ayırt edilemez.
  await expect(page.getByText("Bu adres kayıtlıysa")).toBeVisible();
});

test("uydurma belirteçle parola değiştirilemez", async ({ page }) => {
  await dayanikliGoto(page, "/reset/uydurma-belirtec");
  await page.getByLabel("Yeni parola", { exact: true }).fill("deneme-parola-1234");
  await page.getByLabel("Yeni parola (tekrar)").fill("deneme-parola-1234");
  await page.getByRole("button", { name: "Parolayı değiştir" }).click();

  await expect(page.getByText("Bağlantı geçersiz")).toBeVisible();
});
