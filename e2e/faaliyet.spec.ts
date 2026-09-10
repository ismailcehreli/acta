import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, e2ePassword } from "./global-setup";
import { gunEkle } from "./tarih";

// §5: faaliyet girişi ve düzeltme. Kabul kriteri "giriş 30 saniyeden kısa
// sürmeli" (§18.4/§18.6); buradaki ölçüm o hedefin kaba bir koruması —
// gerçek ölçüm kullanıcıyla yapılacak (Görev 6.3).
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string) {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("oturumsuz kullanıcı faaliyet ekranlarını açamaz", async ({ page }) => {
  await dayanikliGoto(page, "/activities/new");
  await expect(page).toHaveURL(/\/login$/);

  await dayanikliGoto(page, "/activities");
  await expect(page).toHaveURL(/\/login$/);
});

test("faaliyet girişi tek ekranda ve 30 saniyenin altında tamamlanır", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);

  const baslangic = Date.now();

  await dayanikliGoto(page, "/activities/new");
  // Tarih bugüne hazır gelir; kullanıcı yalnızca başlık, açıklama ve muhatap
  // seçer.
  await expect(page.getByLabel("Tarih")).not.toHaveValue("");
  await page.getByLabel("Başlık").fill("Kalıp bakımı yapıldı");
  await page
    .getByLabel("Açıklama")
    .fill("Kalıpta çatlak tespit edildi, yedek parça sipariş edildi.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();

  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);
  await expect(page.locator("#faaliyet-bilgi")).toContainText("kaydedildi");

  const gecenSaniye = (Date.now() - baslangic) / 1000;
  expect(gecenSaniye).toBeLessThan(30);

  await expect(
    page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: "Kalıp bakımı yapıldı" }),
  ).toBeVisible();
});

// Faaliyetin iki tarihi (Görev 11.1). Geçmişe dönük giriş açık olduğu için
// "faaliyetin günü" ile "kaydın yazıldığı an" ayrışabilir. Okuyanın bu farkı
// görmesi gerekir: yoksa "bu iş ne zaman yapıldı" ile "bu kayıt ne zaman
// tutuldu" soruları birbirine karışır.
test("geçmişe dönük kayıtta faaliyet tarihi ile yazım anı ayrı görünür", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);

  // Dün: geçmişe dönük giriş varsayılan olarak 1 güne açık (§5.6).
  // Gün **şirket saatine** göre hesaplanır; UTC ile aradaki fark gece
  // yarısından sonra "dün"ü iki gün öncesine kaydırıyordu (bkz. `e2e/tarih.ts`).
  const dun = gunEkle(-1);
  const baslik = `Dünkü bakım ${String(Date.now()).slice(-6)}`;

  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Tarih").fill(dun);
  await page.getByLabel("Başlık").fill(baslik);
  await page
    .getByLabel("Açıklama")
    .fill("Dün yapılan işin kaydı bugün girildi.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();

  await expect(page).toHaveURL(/\/activities\?kayit=eklendi$/);

  // Listede kaydın yazıldığı an ayrı bir alan olarak durur.
  const satir = page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: baslik });
  await expect(satir).toContainText("Kaydedildi:");

  // Detayda faaliyetin günü dün, yazım anı bugün. İkisi farklı olduğu için
  // yazım anı **tam tarihiyle** yazılır; aynı gün olsaydı yalnız saat yazardı.
  const gunMetni = dun.split("-").reverse().join(".");
  await satir.getByRole("link", { name: baslik }).click();

  await expect(page.getByRole("time").filter({ hasText: gunMetni })).toBeVisible();
  await expect(page.getByText(/Kaydedildi: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/)).toBeVisible();
});

test("boş açıklama ve muhatapsız kayıt reddedilir", async ({ page }) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");

  await page.getByLabel("Başlık").fill("Muhatapsız deneme");
  await page.getByLabel("Açıklama").fill("Bu kayıt muhatapsız gönderiliyor.");
  await page.getByRole("button", { name: "Gönder" }).click();

  await expect(page.locator("#faaliyet-hatasi")).toContainText(
    "En az bir ilgili departman seçilmeli",
  );
});

test("yazan kişi kendi faaliyetini düzeltir ve revizyon sayılır", async ({
  page,
}) => {
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Düzeltilecek faaliyet");
  await page.getByLabel("Açıklama").fill("İlk açıklama metni.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const satir = page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: "Düzeltilecek faaliyet" });
  await satir.getByRole("link", { name: "Düzelt", exact: true }).click();

  await page.getByLabel("Başlık").fill("Düzeltilmiş faaliyet");
  await page.getByRole("button", { name: "Değişikliği kaydet" }).click();

  await expect(page.locator("#faaliyet-bilgi")).toContainText("revizyon");
  await expect(
    page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: "Düzeltilmiş faaliyet" }),
  ).toContainText("2. revizyon");
});

test("başkasının faaliyetinin düzeltme ekranı açılmaz", async ({
  page,
  browser,
}) => {
  // Bir kullanıcı faaliyet yazar.
  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill("Başkasına kapalı faaliyet");
  await page.getByLabel("Açıklama").fill("Bu kaydı yalnızca yazarı düzeltebilir.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const duzeltLinki = page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: "Başkasına kapalı faaliyet" })
    .getByRole("link", { name: "Düzelt", exact: true });
  const hedefUrl = await duzeltLinki.getAttribute("href");
  expect(hedefUrl).toBeTruthy();

  // Başka bir kullanıcı aynı adrese doğrudan gitmeye çalışır.
  const digerOturum = await browser.newContext();
  try {
    const digerSayfa = await digerOturum.newPage();
    await loginAs(digerSayfa, E2E_ADMIN.email);
    const response = await dayanikliGoto(digerSayfa, hedefUrl as string);

    expect(response?.status()).toBe(404);
    await expect(
      digerSayfa.getByText("Başkasına kapalı faaliyet"),
    ).toHaveCount(0);
  } finally {
    await digerOturum.close();
  }
});

test("yazan kişi faaliyetini gerekçeyle iptal eder; kayıt üstü çizili kalır", async ({
  page,
}) => {
  const baslik = `İptal edilecek faaliyet ${String(Date.now()).slice(-6)}`;

  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Yanlış girildi, iptal edilecek.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const satir = page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: baslik });
  await satir.getByRole("link", { name: "İptal et", exact: true }).click();

  // Boş gerekçe tarayıcıda engellenir (alan zorunlu); sunucu tarafındaki aynı
  // kural birim testinde ayrıca sınanıyor.
  await page.getByRole("button", { name: "Faaliyeti iptal et" }).click();
  await expect(page).toHaveURL(/\/cancel$/);

  await page
    .getByLabel("İptal gerekçesi")
    .fill("Yanlış vardiyaya yazıldı, doğrusu ayrıca girilecek.");
  await page.getByRole("button", { name: "Faaliyeti iptal et" }).click();

  await expect(page).toHaveURL(/\/activities\?kayit=iptal$/);

  const iptalSatiri = page.locator('[data-test="faaliyet-satiri"]').filter({ hasText: baslik });
  await expect(iptalSatiri).toContainText("İptal edildi");
  await expect(iptalSatiri).toContainText("Yanlış vardiyaya yazıldı");
  // İptal edilen kayıt artık düzeltilemez ve yeniden iptal edilemez.
  await expect(iptalSatiri.getByRole("link", { name: "Düzelt", exact: true })).toHaveCount(0);
  await expect(iptalSatiri.getByRole("link", { name: "İptal et", exact: true })).toHaveCount(0);

  // Başlık üstü çizili gösterilir (başlık artık detay sayfasına bağlantı).
  await expect(iptalSatiri.locator("a.line-through")).toHaveText(baslik);
});

test("akran başkasının faaliyetini iptal edemez", async ({ page, browser }) => {
  const baslik = `Akrana kapalı ${String(Date.now()).slice(-6)}`;

  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Bu kaydı akran iptal edememeli.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const iptalLinki = page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: baslik })
    .getByRole("link", { name: "İptal et", exact: true });
  const hedefUrl = await iptalLinki.getAttribute("href");

  // E2E yönetici hesabı sistem yöneticisidir ama yazarın üst zincirinde
  // değildir: işlevsel yetki, içerik yetkisi vermez (§15.1).
  const digerOturum = await browser.newContext();
  try {
    const digerSayfa = await digerOturum.newPage();
    await loginAs(digerSayfa, E2E_ADMIN.email);
    const response = await dayanikliGoto(digerSayfa, hedefUrl as string);

    expect(response?.status()).toBe(404);
    await expect(digerSayfa.getByText(baslik)).toHaveCount(0);
  } finally {
    await digerOturum.close();
  }
});

test("sistem yöneticisi başkasının faaliyetini listede göremez", async ({
  page,
  browser,
}) => {
  const baslik = `Yöneticiye kapalı ${String(Date.now()).slice(-6)}`;
  const gizliMetin = "BU ACIKLAMA SIZMAMALI";

  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill(gizliMetin);
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  // Sistem yöneticisi işlevsel yetkiye sahiptir ama yazarın üstünde değildir;
  // §15.1 gereği içerik göremez.
  const yoneticiOturumu = await browser.newContext();
  try {
    const yoneticiSayfasi = await yoneticiOturumu.newPage();
    await loginAs(yoneticiSayfasi, E2E_ADMIN.email);
    await dayanikliGoto(yoneticiSayfasi, "/activities");

    await expect(yoneticiSayfasi.getByText(baslik)).toHaveCount(0);
    await expect(yoneticiSayfasi.getByText(gizliMetin)).toHaveCount(0);
  } finally {
    await yoneticiOturumu.close();
  }
});

test("ek yüklenir, yalnız yetkili indirir", async ({ page, browser, request }) => {
  const suffix = String(Date.now()).slice(-6);
  const baslik = `Ekli faaliyet ${suffix}`;
  // 1×1 piksel PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  await loginAs(page, E2E_USER.email);
  await dayanikliGoto(page, "/activities/new");
  await page.getByLabel("Başlık").fill(baslik);
  await page.getByLabel("Açıklama").fill("Ek içeren faaliyet.");
  await page.getByRole("checkbox", { name: /Şirket/ }).first().check();
  await page.getByLabel("Ekler (isteğe bağlı)").setInputFiles({
    name: "olcum.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "Gönder" }).click();
  await expect(page).toHaveURL(/\/activities/);

  const detayUrl = await page
    .locator('[data-test="faaliyet-satiri"]')
    .filter({ hasText: baslik })
    .getByRole("link", { name: baslik })
    .getAttribute("href");

  await dayanikliGoto(page, detayUrl as string);
  // Resim eki artık önizleme olarak duruyor; indirme adresi katmanın
  // içindeki bağlantıdan alınır (bkz. `ek-dosya.spec.ts`).
  const onizleme = page.locator('[data-test="ek-onizleme"][data-ek-turu="image"]');
  await expect(onizleme).toBeVisible();
  await onizleme.click();

  const katman = page.locator('[data-test="ek-onizleme-katmani"]');
  await expect(katman).toBeVisible();
  const ekUrl = await katman
    .getByRole("link", { name: "İndir" })
    .getAttribute("href");

  // Yetkisiz kullanıcı aynı adrese gittiğinde dosyayı indiremez ve dosyanın
  // varlığını da öğrenemez (§15.4, §18.4).
  const yabanciOturum = await browser.newContext();
  try {
    const yabanci = await yabanciOturum.newPage();
    await loginAs(yabanci, E2E_ADMIN.email);
    const cevap = await dayanikliGoto(yabanci, ekUrl as string);
    expect(cevap?.status()).toBe(404);
  } finally {
    await yabanciOturum.close();
  }

  // Oturumsuz istek de reddedilir.
  const oturumsuz = await request.get(ekUrl as string);
  expect([401, 404]).toContain(oturumsuz.status());
});
