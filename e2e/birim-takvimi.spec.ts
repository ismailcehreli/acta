import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Birime özel mesai penceresi (Görev 11.9).

test.describe.configure({ mode: "serial" });

async function girisYap(page: Page, eposta: string): Promise<void> {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function birimEkle(
  page: Page,
  name: string,
  type: string,
  parent: string,
): Promise<void> {
  await dayanikliGoto(page, "/admin/org/new");
  await page.getByLabel("Birim adı").fill(name);
  await page.getByLabel("Kademe", { exact: true }).fill(type);
  await page.getByLabel("Üst birim").selectOption({ label: parent });
  await page.getByRole("button", { name: "Birim ekle" }).click();
  await expect(page.locator("#org-basarili")).toContainText(name);
  await dayanikliGoto(page, "/admin/org");
}

test("sistem yöneticisi birime özel pencere tanımlar", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/calendar?sekme=birimler");

  await expect(
    page.getByRole("heading", { name: "Birime özel mesai penceresi" }),
  ).toBeVisible();

  // Tanımı olmayan birim üstünden devralıyor ve bunu söylüyor.
  await expect(page.getByText(/devralındı/).first()).toBeVisible();

  await page.getByLabel("Birimin mesai bitişi").fill("17:00");
  await page.getByLabel("Resmî tatillerde çalışılır").check();
  await page.getByRole("button", { name: "Birimi kaydet" }).click();

  await expect(page.getByText("Birimin mesai penceresi kaydedildi.")).toBeVisible();
  // Seçili birim artık kendi tanımını taşıyor.
  await expect(page.getByText("Kendi tanımı").first()).toBeVisible();
});

test("birim tanımı kaldırılınca yeniden devralır", async ({ page }) => {
  await girisYap(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/calendar?sekme=birimler");

  await page
    .getByLabel("Bu birimin kendi tanımını kaldır, üstünden devralsın")
    .check();
  await page.getByRole("button", { name: "Birimi kaydet" }).click();

  await expect(
    page.getByText("Birim artık mesai penceresini üstünden devralıyor."),
  ).toBeVisible();
});

test("bölüm müdürü takvimi düzenleyemez", async ({ page }) => {
  // Ürün sahibi kararı (21.08.2026): takvim sistem yöneticisi seviyesinde.
  await girisYap(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/calendar?sekme=birimler");

  await expect(
    page.getByText(/yalnızca sistem yöneticisi düzenleyebilir/),
  ).toBeVisible();
});

// Birim taşımanın **görünmeyen yan etkisi** (denetim 23.08.2026,
// bulgu 14; tasarım Paket H): taşıma o birimdeki herkesin hatırlatma saatini
// ve skor paydasını kaydırıyor. Ekran yeni üstü seçer seçmez taşıyordu.
test("birim taşınırken mesai penceresi değişikliği onaya sunulur", async ({
  page,
}) => {
  const ek = String(Date.now()).slice(-6);
  const kaynak = `Erken Vardiya ${ek}`;
  const hedef = `Geç Vardiya ${ek}`;
  const tasinan = `Taşınan Ekip ${ek}`;

  await girisYap(page, E2E_ADMIN.email);

  // İki üst birim, iki farklı mesai penceresi.
  for (const ad of [kaynak, hedef]) {
    await birimEkle(page, ad, "Departman", "Şirket");
  }
  await birimEkle(page, tasinan, "Ekip", `— ${kaynak}`);

  // Kaynak birim erken başlar, hedef birim geç.
  const pencereYaz = async (birim: string, baslangic: string) => {
    await dayanikliGoto(page, "/admin/calendar?sekme=birimler");
    // Seçenek etiketleri ağaç girintisi taşıyor ("— — Ekip"); değer üzerinden
    // seçiliyor.
    const deger = await page
      .locator("#unit-calendar-birim option", { hasText: birim })
      .first()
      .getAttribute("value");
    await page.getByLabel("Birim", { exact: true }).selectOption(deger ?? "");
    await page.getByLabel("Birimin mesai başlangıcı").fill(baslangic);
    await page.getByRole("button", { name: "Birimi kaydet" }).click();
    await expect(
      page.getByText("Birimin mesai penceresi kaydedildi."),
    ).toBeVisible();
  };

  await pencereYaz(kaynak, "07:00");
  await pencereYaz(hedef, "10:00");

  // Taşıma denenince önce uyarı çıkar; birim henüz taşınmaz.
  await dayanikliGoto(page, "/admin/org");

  // **Ata–torun ilişkisi seçicide taşınıyor** (denetim 24.08.2026,
  // P4-4). "Üst birim" listesindeki girinti yalnız derinliği kodluyor; kaynak
  // ve hedef aynı derinlikte olduğu için o metin taşıma olmasa da aynı
  // kalıyordu ve test hiçbir şey ölçmüyordu.
  const kaynakAltinda = page.locator(
    `li[data-birim="${kaynak}"] li[data-birim="${tasinan}"]`,
  );
  const hedefAltinda = page.locator(
    `li[data-birim="${hedef}"] li[data-birim="${tasinan}"]`,
  );

  await expect(kaynakAltinda).toHaveCount(1);
  await expect(hedefAltinda).toHaveCount(0);

  const satir = page.locator(`li[data-birim="${tasinan}"]`);
  await satir.getByLabel(`${tasinan} biriminin yeni üstü`).selectOption({
    label: `— ${hedef}`,
  });
  await satir.getByRole("button", { name: "Taşı", exact: true }).click();

  const uyari = page.locator('[data-test="tasima-takvim-uyarisi"]');
  await expect(uyari).toBeVisible();
  await expect(uyari).toContainText("07:00");
  await expect(uyari).toContainText("10:00");

  // Uyarı çıktı ama birim **hâlâ** kaynağın altında: onaysız taşınmadı.
  await expect(kaynakAltinda).toHaveCount(1);
  await expect(hedefAltinda).toHaveCount(0);

  // Onaylanınca taşıma tamamlanır ve birim hedefin alt ağacına geçer.
  await uyari.getByRole("button", { name: "Taşımayı onayla" }).click();

  await expect(hedefAltinda).toHaveCount(1);
  await expect(kaynakAltinda).toHaveCount(0);
});
