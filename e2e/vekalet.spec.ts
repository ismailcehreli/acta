import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import {
  E2E_DYER,
  E2E_DYE_MANAGER,
  E2E_GM,
  E2E_PLANNER,
  E2E_USER,
  e2ePassword,
} from "./global-setup";
import { gunEkle } from "./tarih";

// Vekâlet — uçtan uca (§4.5, ürün sahibi kararı 21.08.2026).
//
// Sınanan zincir: genel müdür bir departman müdürü için izin girer ve başka
// bir departman müdürünü vekil yapar; vekil o departmanın kaydını görür ve
// onaylar; karar "X adına Y" olarak kayda geçer.
//
// **Asıl sınanan şey kapsamın sızmaması:** vekil, vekâlet etmediği bir
// departmanı hiçbir koşulda görmemeli.
//
// Senaryo **Boyahane** üzerinde kurulur: kalıcı olarak onaya tabi olan ve
// bayrağını hiçbir testin değiştirmediği birim (21.08.2026). Önceden
// Kalıphane kullanılıyor ve bayrağı bu spec açıyordu; aynı anda koşan başka
// bir spec kapatınca kayıt onaysız doğuyor ve vekilin kuyruğu boş kalıyordu.
// Her spec tek başına yeşil, paket kırmızıydı — paylaşılan değiştirilebilir
// durumun klasik belirtisi.

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Bugünü kapsayan bir aralık: vekâlet **şu an** geçerli olmalı. */
function bugununAraligi(): { bas: string; bit: string } {
  // Günler **şirket saatine** göre; UTC ile hesaplamak gece yarısından sonra
  // aralığı bir gün kaydırıyordu (bkz. `e2e/tarih.ts`).
  return { bas: gunEkle(-1), bit: gunEkle(3) };
}

test("yönetici olmayan için vekil tanımlanamaz", async ({ page }) => {
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/team/absence");

  const { bas, bit } = bugununAraligi();

  // Kalıphane müdürü, kendi çalışanı için vekil göstermeye çalışıyor.
  await page.getByLabel("Kişi", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Başlangıç").fill(bas);
  await page.getByLabel("Bitiş").fill(bit);

  const vekilKutusu = page.getByLabel("Vekil yönetici");
  const secenekSayisi = await vekilKutusu.locator("option").count();

  if (secenekSayisi > 1) {
    await vekilKutusu.selectOption({ index: 1 });
    await page.getByRole("button", { name: "Kaydet" }).click();

    // Vekâlet yalnız yönetici düzeyinde. Bu ekipte tek ast olduğu için
    // seçilen vekil kişinin kendisi olabiliyor; hangi kural devreye girerse
    // girsin **reddedilmeli** ve gerekçesi ekranda yazmalı.
    await expect(
      page.getByText(
        /yalnız birim yöneticisi|birim yöneticisi olmalı|kendi vekili olamaz/,
      ),
    ).toBeVisible();
  }
});

test("vekil, vekâlet ettiği departmanın kaydını görür ve onaylar", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Vekâlet denemesi ${suffix}`;

  // Boyahane kalıcı olarak onaya tabi; hiçbir hazırlık adımı gerekmiyor.
  //
  // 1) Genel müdür, Boyahane müdürü için izin girer ve Planlama müdürünü
  //    vekil yapar.
  const gm = await browser.newContext();
  try {
    const gmSayfa = await gm.newPage();
    await girisYap(gmSayfa, E2E_GM.email);
    await dayanikliGoto(gmSayfa, "/team/absence");

    const { bas, bit } = bugununAraligi();
    await gmSayfa
      .getByLabel("Kişi", { exact: true })
      .selectOption({ label: E2E_DYE_MANAGER.fullName });
    await gmSayfa.getByLabel("Başlangıç").fill(bas);
    await gmSayfa.getByLabel("Bitiş").fill(bit);
    await gmSayfa
      .getByLabel("Vekil yönetici")
      .selectOption({ label: E2E_PLANNER.fullName });
    await gmSayfa.getByRole("button", { name: "Kaydet" }).click();

    await expect(gmSayfa.getByText("Bu tarihlerde hatırlatma gitmez")).toBeVisible();
  } finally {
    await gm.close();
  }

  // 2) Boyahane çalışanı faaliyet yazar; onay Boyahane müdürüne düşer.
  const calisan = await browser.newContext();
  try {
    const sayfa = await calisan.newPage();
    await girisYap(sayfa, E2E_DYER.email);
    await dayanikliGoto(sayfa, "/activities/new");
    await sayfa.getByLabel("Başlık").fill(baslik);
    await sayfa.getByLabel("Açıklama").fill("Vekâlet sınaması için yazıldı.");
    await sayfa.getByRole("checkbox", { name: /Şirket/ }).first().check();
    await sayfa.getByRole("button", { name: "Gönder" }).click();
    await expect(sayfa).toHaveURL(/\/activities\?kayit=eklendi$/);
  } finally {
    await calisan.close();
  }

  // 3) Planlama müdürü — normalde Boyahane'yi hiç görmez — vekâlet
  //    süresince kaydı görür ve onaylayabilir.
  const vekil = await browser.newContext();
  try {
    const sayfa = await vekil.newPage();
    await girisYap(sayfa, E2E_PLANNER.email);

    await dayanikliGoto(sayfa, "/deputy");
    await expect(sayfa.locator('[data-test="aktif-vekalet"]')).toBeVisible();
    await expect(sayfa.locator('[data-test="aktif-vekalet"]')).toContainText(
      E2E_DYE_MANAGER.fullName,
    );

    // Kayıt vekilin iş kuyruğunda görünmeli.
    await dayanikliGoto(sayfa, "/");
    const kuyruk = sayfa.locator('[data-test="bana-dusenler"]');
    await expect(kuyruk.getByText(baslik)).toBeVisible();

    // Onay kararını vekil verir; detay ekranından, gerçek yoldan.
    await kuyruk.getByRole("link", { name: baslik }).click();
    await sayfa.getByRole("button", { name: "Onayla" }).click();
    await expect(sayfa.getByText("onay bekliyor")).toHaveCount(0);

    // Karar vekâlet sayfasında "X adına Y" olarak görünmeli.
    await dayanikliGoto(sayfa, "/deputy");
    const karar = sayfa
      .locator('[data-test="vekalet-karari"]')
      .filter({ hasText: baslik });
    await expect(karar).toBeVisible();
    await expect(karar).toContainText(`${E2E_DYE_MANAGER.fullName} adına`);
  } finally {
    await vekil.close();
  }

  // 4) Dönen yönetici, yokluğunda ne olduğunu görür.
  const donen = await browser.newContext();
  try {
    const sayfa = await donen.newPage();
    await girisYap(sayfa, E2E_DYE_MANAGER.email);
    await dayanikliGoto(sayfa, "/deputy");

    await expect(
      sayfa.getByRole("heading", { name: "Yokluğumda yerime bakanlar" }),
    ).toBeVisible();
    await expect(
      sayfa
        .locator('[data-test="vekalet-donemi"]')
        .filter({ hasText: E2E_PLANNER.fullName }),
    ).toBeVisible();
  } finally {
    await donen.close();
  }
});

test("vekâlet edilmeyen kişi kapsamı görmez", async ({ page }) => {
  // Boyahane çalışanı vekil değil; vekâlet sayfası ona bağlantı bile
  // vermemeli ve kapsamı açılmamalı.
  await girisYap(page, E2E_DYER.email);

  const menu = page.getByRole("navigation", { name: "Ana menü" });
  await expect(menu.getByRole("link", { name: /Vekâlet/ })).toHaveCount(0);
});
