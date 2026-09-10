import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FOOTER_TEXT,
  DEFAULT_PAGE_TITLE,
  readBranding,
  removeLogo,
  saveBrandingTexts,
} from "@/server/settings/branding";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Marka metinleri (ürün sahibi kararı, 19.08.2026): üst çubukta yalnız logo
// durur; ad yerine sekme başlığı ve alt şerit metni tanımlanır.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** Ayar değişiklikleri iz bırakıyor (§15.2); iz bir aktör ister. */
async function yonetici() {
  const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
  return createUser(birim.id, { email: "yonetici@ornek.test", isSystemAdmin: true });
}

describe("marka metinleri", () => {
  it("hiç ayar yokken varsayılanlar döner", async () => {
    const brand = await readBranding(testDb);

    expect(brand.pageTitle).toBe(DEFAULT_PAGE_TITLE);
    expect(brand.footerText).toBe(DEFAULT_FOOTER_TEXT);
    expect(brand.logoUrl).toBeNull();
  });

  it("kaydedilen metinler okunur", async () => {
    const aktor = await yonetici();
    await saveBrandingTexts(
      testDb,
      {
        pageTitle: "Acta Workspace",
        footerText: "Acta · Internal",
      },
      aktor.id,
    );

    const brand = await readBranding(testDb);
    expect(brand.pageTitle).toBe("Acta Workspace");
    expect(brand.footerText).toBe("Acta · Internal");
  });

  it("eski 'şirket adı' değeri sayfa başlığı olarak okunur", async () => {
    // Alan adı değişti; güncelleme sonrası başlığın bir anda varsayılana
    // düşmemesi için okuma tarafı eski anahtarı da kabul ediyor.
    await testDb.systemSetting.create({
      data: { key: "company_name", value: "Eski Ad", description: "eski" },
    });

    const brand = await readBranding(testDb);
    expect(brand.pageTitle).toBe("Eski Ad");
  });

  it("yeni başlık eski değerin önüne geçer", async () => {
    await testDb.systemSetting.create({
      data: { key: "company_name", value: "Eski Ad", description: "eski" },
    });
    const aktor = await yonetici();
    await saveBrandingTexts(
      testDb,
      {
        pageTitle: "Yeni Başlık",
        footerText: "Alt şerit",
      },
      aktor.id,
    );

    const brand = await readBranding(testDb);
    expect(brand.pageTitle).toBe("Yeni Başlık");
  });
});

describe("logo dosyası ile ayar ayrıştığında", () => {
  // Ayar satırı veritabanında, dosya diskte durur. Depolama dizini
  // temizlenirse satır kalır, dosya gider — ve sayfa **kırık resim** çizerdi.
  // 20.08.2026'da yerelde tam olarak bu görüldü: giriş ekranında kırık logo.
  const logoDizini = path.join(process.cwd(), "storage", "branding");

  async function ayariKur() {
    await testDb.systemSetting.create({
      data: {
        key: "company_logo_extension",
        value: "svg",
        description: "logo türü",
      },
    });
  }

  it("dosya yoksa logo gösterilmez ve tutarsızlık günlüğe yazılır", async () => {
    await ayariKur();
    await rm(path.join(logoDizini, "logo.svg"), { force: true });

    // `mockRestore()` kaydedilen çağrıları da siler; bu yüzden önce okunur.
    const gunluk = vi.spyOn(console, "error").mockImplementation(() => {});
    let cagrilar: unknown[][];
    let brand;
    try {
      brand = await readBranding(testDb);
      cagrilar = gunluk.mock.calls.map((c) => [...c]);
    } finally {
      gunluk.mockRestore();
    }

    expect(brand.logoUrl).toBeNull();
    // Sessizce gizlemek yetmez: sistem yöneticisi logoyu yeniden yükleyebilsin.
    expect(cagrilar).toHaveLength(1);
    expect(String(cagrilar[0]?.[0])).toContain("logo.svg");
  });

  it("dosya varsa logo adresi döner", async () => {
    await ayariKur();
    await mkdir(logoDizini, { recursive: true });
    await writeFile(path.join(logoDizini, "logo.svg"), "<svg/>");

    try {
      const brand = await readBranding(testDb);
      expect(brand.logoUrl).toBe("/api/branding/logo?v=svg");
    } finally {
      await rm(path.join(logoDizini, "logo.svg"), { force: true });
    }
  });
});

// AYAR DEĞİŞİKLİKLERİ İZ BIRAKIR (§15.2, denetim 21.08.2026, bulgu 14).
//
// Marka metinleri, logo ve SMTP parolasının silinmesi veriyi değiştiriyor ama
// hiç `recordAudit` çağırmıyordu. Aynı ekrandaki normal SMTP kaydı ize
// yazılırken bunlar yazılmıyordu; özellikle SMTP parolasının silinmesi bütün
// bildirim kanalını durdurabildiği hâlde izsiz kalıyordu.
describe("marka değişiklikleri denetim izine yazılır", () => {
  it("metin kaydı iz bırakır", async () => {
    const aktor = await yonetici();

    await saveBrandingTexts(
      testDb,
      { pageTitle: "Yeni başlık", footerText: "Yeni şerit" },
      aktor.id,
    );

    const iz = await testDb.auditLog.findFirstOrThrow({
      where: { action: "branding_changed" },
    });
    expect(iz.userId).toBe(aktor.id);
    expect(iz.objectId).toBe("branding");
  });

  it("logo kaldırma iz bırakır", async () => {
    const aktor = await yonetici();

    await removeLogo(testDb, aktor.id);

    const iz = await testDb.auditLog.findFirstOrThrow({
      where: { action: "logo_removed" },
    });
    expect(iz.userId).toBe(aktor.id);
  });
});
