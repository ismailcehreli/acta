import { dayanikliGoto } from "./gezinme";
import { expect, test } from "./test-tabani";

test("giriş sayfası açılıyor", async ({ page }) => {
  await dayanikliGoto(page, "/login");
  await expect(
    page.getByRole("heading", { name: "Giriş yap" }),
  ).toBeVisible();
});

test("Tailwind stilleri sayfaya uygulanıyor", async ({ page }) => {
  await dayanikliGoto(page, "/login");
  const heading = page.getByRole("heading", { name: "Giriş yap" });

  // Giriş ekranı başlığı sayfa başlığı ölçeğinde (--text-2xl = 27px). Stil
  // derlenmemiş olsaydı tarayıcı varsayılanı (h1 için 32px) gelirdi.
  await expect(heading).toHaveCSS("font-size", "27px");
});

test("sağlık ucu veritabanı bağlantısını ölçüyor", async ({ request }) => {
  const response = await request.get("/api/health");

  const report = await response.json();

  // Veritabanı ayakta.
  expect(report.database.status).toBe("ok");
  expect(typeof report.database.latencyMs).toBe("number");

  // Genel durum yalnız veritabanına bakmaz: uçtan uca koşuda işleyici süreci
  // çalışmadığı için zamanlayıcı gecikmiş ve rapor "down" diyor (Görev 5.6).
  // Zamanlayıcının durduğu bir sistemde "ok" demek, §12.4'ün önlemeye
  // çalıştığı sessiz arızanın ta kendisi olurdu.
  expect(report.scheduler.status).toBe("down");
  expect(report.status).toBe("down");
  expect(response.status()).toBe(503);

  // Ayrıntılı sınama `e2e/isler.spec.ts` içinde.
  expect(report.notificationQueue).toHaveProperty("depth");
});
