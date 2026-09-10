import { dayanikliGoto } from "./gezinme";
import { expect, test, type Browser, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_GM, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

// Kişi + gün bazlı toplu onay (Görev 10.6).

test.describe.configure({ mode: "serial" });

async function openAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

async function onayaTabiYap(page: Page, acik: boolean): Promise<void> {
  await dayanikliGoto(page, "/admin/org");
  const satir = page.locator('[data-birim="Kalıphane"]');
  await satir.getByRole("button", { name: "Düzenle" }).click();
  const form = satir.locator("form[data-test^='birim-duzenle-']");
  const kutu = form.getByRole("checkbox", {
    name: "Bu birimdeki faaliyetler onaya tabidir",
  });
  if (acik) await kutu.check();
  else await kutu.uncheck();
  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await dayanikliGoto(page, "/admin/org");
  const guncel = page.locator('[data-birim="Kalıphane"]');
  if (acik) {
    await expect(guncel.getByText("onaya tabi", { exact: true })).toBeVisible();
  } else {
    await expect(guncel.getByText("onaya tabi", { exact: true })).toHaveCount(0);
  }
}

async function faaliyetYaz(page: Page, baslik: string): Promise<void> {
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill(`${baslik} için açıklama metni.`);
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);
}

test("onayı olmayan boş ekran görür", async ({ browser }) => {
  const page = await openAs(browser, "e2e-planlama@ornek.test");

  try {
    await dayanikliGoto(page, "/approvals");
    await expect(page.getByText("Onayınızı bekleyen kayıt yok.")).toBeVisible();
    // Başkasının kaydı sızmamalı.
    await expect(page.locator('[data-test="onay-grubu"]')).toHaveCount(0);
  } finally {
    await page.context().close();
  }
});

test("müdür bir kişinin gününü tek işlemle onaylar", async ({ browser }) => {
  test.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-6);
  const bir = `Toplu bir ${suffix}`;
  const iki = `Toplu iki ${suffix}`;
  const uc = `Toplu üç ${suffix}`;

  const admin = await openAs(browser, E2E_ADMIN.email);
  const calisan = await openAs(browser, E2E_WORKER.email);
  const mudur = await openAs(browser, E2E_USER.email);
  const genelMudur = await openAs(browser, E2E_GM.email);

  try {
    await onayaTabiYap(admin, true);

    for (const baslik of [bir, iki, uc]) await faaliyetYaz(calisan, baslik);

    // İş kuyruğundan toplu ekrana kısa yol var.
    await dayanikliGoto(mudur, "/");
    await mudur.getByRole("link", { name: "Toplu onayla" }).click();
    await expect(mudur).toHaveURL(/\/approvals$/);

    const grup = mudur
      .locator('[data-test="onay-grubu"]')
      .filter({ hasText: "Kalıphane Çalışanı" });
    await expect(grup).toBeVisible();

    // Üçü de **aynı grupta**: aynı kişi, aynı gün. Grubun toplam sayısını
    // iddia etmiyoruz — başka testlerin bıraktığı bekleyen kayıtlar da aynı
    // güne düşebilir ve test konusuyla ilgisiz bir sebeple kırılırdı.
    for (const baslik of [bir, iki, uc]) {
      await expect(
        grup.locator('[data-test="onay-kaydi"]').filter({ hasText: baslik }),
      ).toHaveCount(1);
    }

    // Açıklamalar da görünüyor; müdür okumadan onaylamasın.
    await expect(grup).toContainText("için açıklama metni");

    const gorunen = await grup.locator('[data-test="onay-kaydi"]').count();
    await grup
      .getByRole("button", { name: new RegExp(`Görünen ${gorunen} kaydı onayla`) })
      .click();

    await expect(mudur).toHaveURL(
      new RegExp(`/approvals\\?onaylandi=${gorunen}$`),
    );
    await expect(mudur.locator("#onay-bilgi")).toContainText(
      `${gorunen} kayıt onaylandı.`,
    );

    // Onaydan sonra üst kademe görüyor.
    await dayanikliGoto(genelMudur, `/search?q=${encodeURIComponent(String(suffix))}`);
    for (const baslik of [bir, iki, uc]) {
      await expect(genelMudur.getByText(baslik).first()).toBeVisible();
    }

    // Kuyruk boşaldı.
    await dayanikliGoto(mudur, "/approvals");
    await expect(
      mudur.locator('[data-test="onay-grubu"]').filter({ hasText: "Kalıphane Çalışanı" }),
    ).toHaveCount(0);
  } finally {
    await onayaTabiYap(admin, false).catch(() => undefined);
    for (const page of [admin, calisan, mudur, genelMudur]) {
      await page.context().close();
    }
  }
});
