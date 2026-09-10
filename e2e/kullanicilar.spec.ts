import { beklenenYonlendirmeliGoto, dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_USER, E2E_WORKER, e2ePassword } from "./global-setup";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, email: string): Promise<void> {
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createUser(
  page: Page,
  {
    fullName,
    email,
    password,
    writesActivities = true,
    isScored = true,
    canAppreciate = false,
  }: {
    fullName: string;
    email: string;
    password: string;
    writesActivities?: boolean;
    isScored?: boolean;
    canAppreciate?: boolean;
  },
) {
  await dayanikliGoto(page, "/admin/users/new");
  await page.getByLabel("Ad soyad").fill(fullName);
  await page.getByLabel("E-posta", { exact: true }).fill(email);
  await page.getByLabel("Birim", { exact: true }).selectOption({ label: "Şirket" });
  await page.getByLabel("Başlangıç parolası").fill(password);

  const writes = page.getByRole("checkbox", { name: "Günlük faaliyet yazar" });
  if (!writesActivities) await writes.uncheck();

  const scored = page.getByRole("checkbox", { name: "Skoru hesaplansın" });
  if (!isScored) await scored.uncheck();

  const appreciate = page.getByRole("checkbox", { name: "Faaliyetlere takdir verebilir" });
  if (canAppreciate) await appreciate.check();

  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  await expect(page.locator("#kullanici-basarili")).toContainText("eklendi");

  await dayanikliGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  return row;
}

async function openUserDetail(page: Page, email: string): Promise<void> {
  await dayanikliGoto(page, `/admin/users?q=${encodeURIComponent(email)}`);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Detayı aç" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/]+/);
}

test("oturumsuz kullanıcı kullanıcı yönetimine giremez", async ({ page }) => {
  await dayanikliGoto(page, "/admin/users");

  await expect(page).toHaveURL(/\/login$/);
});

test("yönetici olmayan kullanıcı listeyi göremez", async ({ page }) => {
  await loginAs(page, E2E_WORKER.email);
  await dayanikliGoto(page, "/admin/users");

  await expect(
    page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" }),
  ).toBeVisible();
  await expect(page.getByText(E2E_ADMIN.email)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Yeni kullanıcı" })).toHaveCount(0);
});

test("sistem yöneticisi kullanıcı ekler ve yeni kullanıcı giriş yapabilir", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `yeni-${suffix}@ornek.test`;
  const password = `baslangic-${suffix}-parola`;

  await loginAs(page, E2E_ADMIN.email);
  await expect(
    await createUser(page, {
      fullName: `Deneme Kişi ${suffix}`,
      email,
      password,
    }),
  ).toContainText(email);

  const yeniOturum = await browser.newContext();
  try {
    const yeniSayfa = await yeniOturum.newPage();
    await dayanikliGoto(yeniSayfa, "/login");
    await yeniSayfa.getByLabel("E-posta", { exact: true }).fill(email);
    await yeniSayfa.getByLabel("Parola", { exact: true }).fill(password);
    await yeniSayfa.getByRole("button", { name: "Giriş yap" }).click();

    await expect(yeniSayfa).toHaveURL(/\/$/);
    await expect(
      yeniSayfa.getByRole("banner").getByText(`Deneme Kişi ${suffix}`),
    ).toBeVisible();
  } finally {
    await yeniOturum.close();
  }
});

test("aynı e-posta ikinci kez eklenemez", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await dayanikliGoto(page, "/admin/users/new");

  await page.getByLabel("Ad soyad").fill("Kopya Kayıt");
  await page.getByLabel("E-posta", { exact: true }).fill(E2E_USER.email);
  await page.getByLabel("Birim", { exact: true }).selectOption({ label: "Şirket" });
  await page.getByLabel("Başlangıç parolası").fill("baslangic-parolasi-1");
  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();

  await expect(page.locator("#kullanici-hatasi")).toContainText("zaten kayıtlı");
});

test("eklenen kullanıcı pasifleştirilir ve oturumu düşer", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `pasif-${suffix}@ornek.test`;
  const password = `baslangic-${suffix}-parola`;

  await loginAs(page, E2E_ADMIN.email);
  await createUser(page, {
    fullName: `Pasifleşecek Kişi ${suffix}`,
    email,
    password,
  });

  const oturum = await browser.newContext();
  const kullaniciSayfasi = await oturum.newPage();
  try {
    await dayanikliGoto(kullaniciSayfasi, "/login");
    await kullaniciSayfasi.getByLabel("E-posta", { exact: true }).fill(email);
    await kullaniciSayfasi.getByLabel("Parola", { exact: true }).fill(password);
    await kullaniciSayfasi.getByRole("button", { name: "Giriş yap" }).click();
    await expect(kullaniciSayfasi).toHaveURL(/\/$/);

    await openUserDetail(page, email);
    await page.getByRole("button", { name: "Hesabı pasifleştir" }).click();
    await page.reload();
    await expect(
      page.getByText("Kullanıcı sisteme giriş yapamaz; geçmiş kayıtları korunur."),
    ).toBeVisible();

    await dayanikliGoto(kullaniciSayfasi, "/");
    await expect(kullaniciSayfasi).toHaveURL(/\/login$/);

    await page.getByRole("button", { name: "Hesabı aktifleştir" }).click();
    await page.reload();
    await expect(page.getByText("Kullanıcı sisteme giriş yapabilir.")).toBeVisible();

    await dayanikliGoto(page, "/admin/audit?objectType=user&action=user_reactivated");
    await expect(
      page.locator('[data-test="denetim-kaydi"]').first(),
    ).toContainText("kullanıcı aktifleştirildi");
  } finally {
    await oturum.close();
  }
});

test("sistem yöneticisi kullanıcı bilgisini düzenler", async ({ page }) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `duzenlenecek-${suffix}@ornek.test`;
  const yeniEposta = `duzenlendi-${suffix}@ornek.test`;

  await loginAs(page, E2E_ADMIN.email);
  await createUser(page, {
    fullName: `Düzenlenecek ${suffix}`,
    email,
    password: `baslangic-${suffix}-parola`,
  });
  await openUserDetail(page, email);

  await page.getByLabel("Ad soyad").fill(`Yeni Ad ${suffix}`);
  await page.getByLabel("E-posta", { exact: true }).fill(yeniEposta);
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText(`"Yeni Ad ${suffix}" güncellendi.`)).toBeVisible();
  await page.reload();

  await expect(
    page.getByRole("heading", { level: 1, name: `Yeni Ad ${suffix}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(yeniEposta, { exact: false })).toBeVisible();
});

test("sistem yöneticisi parola belirler; kullanıcı yeni parolayla girer", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `parolasi-${suffix}@ornek.test`;
  const ilkParola = `baslangic-${suffix}-parola`;
  const yeniParola = `yonetici-${suffix}-parola`;

  await loginAs(page, E2E_ADMIN.email);
  await createUser(page, {
    fullName: `Parola Kişisi ${suffix}`,
    email,
    password: ilkParola,
  });

  const oturum = await browser.newContext();
  try {
    const kullaniciSayfasi = await oturum.newPage();
    await dayanikliGoto(kullaniciSayfasi, "/login");
    await kullaniciSayfasi.getByLabel("E-posta", { exact: true }).fill(email);
    await kullaniciSayfasi.getByLabel("Parola", { exact: true }).fill(ilkParola);
    await kullaniciSayfasi.getByRole("button", { name: "Giriş yap" }).click();
    await expect(kullaniciSayfasi).toHaveURL(/\/$/);

    await openUserDetail(page, email);
    await page.getByLabel("Yeni parola").fill(yeniParola);
    await page.getByRole("button", { name: "Parolayı değiştir" }).click();
    await expect(page.getByText("Parola değiştirildi")).toBeVisible();

    await beklenenYonlendirmeliGoto(kullaniciSayfasi, "/", /\/login$/);
    await expect(kullaniciSayfasi).toHaveURL(/\/login$/);

    await kullaniciSayfasi.getByLabel("E-posta", { exact: true }).fill(email);
    await kullaniciSayfasi.getByLabel("Parola", { exact: true }).fill(yeniParola);
    await kullaniciSayfasi.getByRole("button", { name: "Giriş yap" }).click();
    await expect(kullaniciSayfasi).toHaveURL(/\/$/);
  } finally {
    await oturum.close();
  }
});

test("faaliyet yazmayan kullanıcının ana ekranında o blok çıkmaz", async ({
  page,
  browser,
}) => {
  const suffix = String(Date.now()).slice(-6);
  const email = `yk-${suffix}@ornek.test`;
  const password = `Kurul-${suffix}-parola`;

  await loginAs(page, E2E_ADMIN.email);
  const row = await createUser(page, {
    fullName: `YK Üyesi ${suffix}`,
    email,
    password,
    writesActivities: false,
  });
  await expect(row).toContainText("faaliyet yazmaz");

  const oturum = await browser.newContext();
  try {
    const kurul = await oturum.newPage();
    await dayanikliGoto(kurul, "/login");
    await kurul.getByLabel("E-posta", { exact: true }).fill(email);
    await kurul.getByLabel("Parola", { exact: true }).fill(password);
    await kurul.getByRole("button", { name: "Giriş yap" }).click();
    await expect(kurul).toHaveURL(/\/$/);

    await expect(kurul.getByRole("heading", { name: "Benim durumum" })).toBeVisible();
    await expect(kurul.getByText("Bugün henüz faaliyet girmediniz.")).toHaveCount(0);
    await expect(kurul.getByRole("heading", { name: "Bana düşenler" })).toBeVisible();
  } finally {
    await oturum.close();
  }
});

test("sistem yöneticisi kendi hesabını yönetim yolundan değiştiremez", async ({ page }) => {
  await loginAs(page, E2E_ADMIN.email);
  await openUserDetail(page, E2E_ADMIN.email);

  await expect(
    page.getByRole("heading", { name: "Bu sayfayı görüntüleyemezsiniz" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Hesabı pasifleştir" })).toHaveCount(0);
});
