import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";

// Ağaç kurma akışı (§4) ve yetki ayrımı (§15.1). Aynı veritabanını paylaştıkları
// için testler sırayla koşar ve her koşu kendi benzersiz birim adını kullanır.
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Ağaçtaki birim satırı.
 *
 * Metne göre süzmek kırılgandı: her satırın içinde "yeni üstü" açılır listesi
 * var ve o liste **bütün birimlerin adını** taşıyor. Aranan ad başka bir
 * birimin listesinde geçtiği için yanlış satır seçilebiliyordu (22.08.2026'da
 * paralel koşuda düştü). Ağaç her düğüme `data-birim` yazıyor; adres o.
 */
function birimSatiri(page: Page, ad: string) {
  return page.locator(`li[data-birim="${ad}"]`);
}

async function birimEkle(
  page: Page,
  {
    name,
    type,
    parent,
    attentionGroup,
    requiresApproval = false,
  }: {
    name: string;
    type: string;
    parent: string;
    attentionGroup?: string;
    requiresApproval?: boolean;
  },
): Promise<void> {
  await dayanikliGoto(page, "/admin/org/new");
  await page.getByLabel("Birim adı").fill(name);
  await page.getByLabel("Kademe", { exact: true }).fill(type);
  await page.getByLabel("Üst birim").selectOption({ label: parent });
  if (attentionGroup) {
    await page.getByLabel("Dikkat grubu (isteğe bağlı)").fill(attentionGroup);
  }
  if (requiresApproval) {
    await page
      .getByRole("checkbox", { name: "Bu birimdeki faaliyetler onaya tabidir" })
      .check();
  }
  await page.getByRole("button", { name: "Birim ekle" }).click();
  await expect(page.locator("#org-basarili")).toContainText(name);
  await dayanikliGoto(page, "/admin/org");
}

test("oturumsuz kullanıcı yönetim ekranına giremez", async ({ page }) => {
  await dayanikliGoto(page, "/admin/org");

  await expect(page).toHaveURL(/\/login$/);
});

test("sistem yöneticisi olmayan kullanıcı organizasyon ağacını göremez", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/admin/org");

  await expect(
    page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" }),
  ).toBeVisible();
  // Ağaç ve düzenleme araçları hiç render edilmemeli.
  await expect(
    page.getByRole("heading", { name: "Organizasyon ağacı" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Birim ekle" })).toHaveCount(0);
});

test("sistem yöneticisi ağaca birim ekler, taşır ve pasifleştirir", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const departman = `Kalıphane ${suffix}`;
  const altBirim = `Kalıp Bakım ${suffix}`;

  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/org");
  await expect(
    page.getByRole("heading", { name: "Organizasyon ağacı" }),
  ).toBeVisible();

  // Kök birim kurulum aşamasında oluşturuldu; altına yeni departman eklenir.
  await birimEkle(page, { name: departman, type: "Departman", parent: "Şirket" });
  // Ağaç listesinde göründüğünü doğrula (seçim kutusundaki seçenek değil).
  await expect(
    birimSatiri(page, departman),
  ).toBeVisible();

  // Yeni departmanın altına bir alt birim eklenir: ağaç gerçekten kuruluyor.
  await birimEkle(page, {
    name: altBirim,
    type: "Ekip",
    parent: `— ${departman}`,
  });
  await expect(page.getByRole("link", { name: "Yeni birim" })).toBeVisible();

  // Alt birim pasifleştirilir; kayıt silinmez, "pasif" etiketiyle kalır.
  // Satır metnine bakmak yanıltıcıdır: "Pasifleştir" butonu da "pasif"
  // kelimesini içerir ve işlem hiç çalışmasa bile test geçerdi.
  const altSatir = birimSatiri(page, altBirim);
  await altSatir.getByRole("button", { name: "Pasifleştir" }).click();

  const pasifSatir = birimSatiri(page, altBirim);
  await expect(pasifSatir.getByText("pasif", { exact: true })).toBeVisible();
  await expect(
    pasifSatir.getByRole("button", { name: "Pasifleştir" }),
  ).toHaveCount(0);

  // Pasif birim geri açılabilir (ürün sahibi kararı, 19.08.2026).
  await pasifSatir.getByRole("button", { name: "Aktifleştir" }).click();

  const acilanSatir = birimSatiri(page, altBirim);
  await expect(acilanSatir.getByText("pasif", { exact: true })).toHaveCount(0);
  await expect(
    acilanSatir.getByRole("button", { name: "Pasifleştir" }),
  ).toBeVisible();

  // İşlem denetim izinde görünür.
  // Aynı gerekçe: kayıt kendi birim adıyla bulunur.
  await dayanikliGoto(page, "/admin/audit?objectType=org_unit&action=org_unit_reactivated");
  await expect(
    page.locator('[data-test="denetim-kaydi"]').filter({ hasText: altBirim }),
  ).toContainText("birim aktifleştirildi");
});

test("sistem yöneticisi birimin adını, kademesini ve bayraklarını düzenler", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const eskiAd = `Yanlış Ad ${suffix}`;
  const yeniAd = `Kalıphane ${suffix}`;

  await loginAs(page, E2E_ADMIN.email);
  await birimEkle(page, { name: eskiAd, type: "Ekip", parent: "Şirket" });

  // Düzenleme formu satırın altında açılır.
  const satir = birimSatiri(page, eskiAd);
  await satir.getByRole("button", { name: "Düzenle" }).click();

  const form = satir.locator("form[data-test^='birim-duzenle-']");
  await expect(form).toBeVisible();

  await form.getByLabel("Birim adı").fill(yeniAd);
  // `exact` şart: "Kademe" metni "Faaliyetler üst kademelere akar" onay
  // kutusuyla da eşleşiyor.
  await form.getByLabel("Kademe", { exact: true }).fill("Departman");
  await form.getByLabel("Dikkat grubu (isteğe bağlı)").fill("yonetim-kurulu");
  await form
    .getByRole("checkbox", { name: "Bu birimdeki faaliyetler onaya tabidir" })
    .check();
  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();

  // Ağaç yeni değerlerle geliyor: ad, kademe ve iki rozet.
  const yeniSatir = birimSatiri(page, yeniAd);
  await expect(yeniSatir).toContainText("Departman");
  // `exact` şart: açık kalan düzenleme formunda "…onaya tabidir" metni de var.
  await expect(yeniSatir.getByText("onaya tabi", { exact: true })).toBeVisible();
  await expect(
    yeniSatir.getByText("dikkat grubu: yonetim-kurulu", { exact: true }),
  ).toBeVisible();
  // Eski ad ağaçta kalmamalı; "kaydedildi" mesajı tek başına kanıt değil.
  await expect(birimSatiri(page, eskiAd)).toHaveCount(0);

  // Yapılan düzenleme denetim izinde görünür (§15.2).
  //
  // Kayıt **kendi adıyla** bulunur, `.first()` ile değil: başka testler de
  // birim düzenliyor ve paylaşılan veritabanında "en yeni kayıt" bu testin
  // kaydı olmak zorunda değil. `.first()` kullanan hâli paralel koşuda
  // başkasının kaydına bakıp kırılıyordu.
  await dayanikliGoto(page, "/admin/audit?objectType=org_unit&action=org_unit_updated");
  const kayit = page
    .locator('[data-test="denetim-kaydi"]')
    .filter({ hasText: yeniAd });
  await expect(kayit).toContainText("birim düzenlendi");
  await expect(kayit).toContainText(E2E_ADMIN.fullName);
});

test("aktif alt birimi olan birim pasifleştirilemez", async ({ page }) => {
  const ust = `Direktörlük ${String(Date.now()).slice(-6)}`;
  const alt = `Alt ${String(Date.now()).slice(-6)}`;

  await loginAs(page, E2E_ADMIN.email);
  await birimEkle(page, { name: ust, type: "Direktörlük", parent: "Şirket" });
  await birimEkle(page, {
    name: alt,
    type: "Departman",
    parent: `— ${ust}`,
  });

  const ustSatir = birimSatiri(page, ust);
  await ustSatir.getByRole("button", { name: "Pasifleştir" }).first().click();

  await expect(page.getByText(/altında aktif birimler var/i)).toBeVisible();
});

// Denetim FAZ 2, bulgu 5: `attentionGroupId` şemada vardı ama yönetim
// ekranından hiç kaydedilemiyordu; birim testi doğrudan servisi çağırdığı için
// bunu yakalamamıştı. Bu test form → sunucu eylemi → veritabanı yolunu izler.
test("dikkat grubu ekrandan kaydedilir ve yeniden yüklemede korunur", async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const birim = `Yönetim Kurulu ${suffix}`;
  const grup = `yk-${suffix}`;

  await loginAs(page, E2E_ADMIN.email);
  await birimEkle(page, {
    name: birim,
    type: "Kurul",
    parent: "Şirket",
    attentionGroup: grup,
  });

  // Sayfa yeniden yüklendiğinde değer veritabanından gelmelidir.
  await page.reload();
  await expect(
    birimSatiri(page, birim),
  ).toContainText(`dikkat grubu: ${grup}`);
});
