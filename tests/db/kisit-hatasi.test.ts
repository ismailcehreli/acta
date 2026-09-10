import { describe, expect, it } from "vitest";

import { hasDatabaseSentinel, isUniqueViolation } from "@/server/db-errors";
import { createUser } from "@/server/users/create";

// Veritabanı kısıt hatalarının doğru mesaja çevrilmesi.
//
// Bu testler **üretim derlemesinde** ortaya çıkan bir hatadan doğdu
// (22.08.2026, WebKit koşusu sırasında). Prisma, paketlenmiş kodda hata
// mesajının başına **minifiye modül kaynağını** koyuyor. O kaynağın içinde
// `includes("USER_INACTIVE_ORG_UNIT")` gibi satırlar geçtiği için, hata
// metninde çıplak dizge aramak yanlış dalı seçiyordu: sistem yöneticisi
// "bu e-posta zaten kayıtlı" yerine "pasif bir birime aktif kullanıcı
// bağlanamaz" mesajını görüyordu.
//
// Testler bundle'lanmamış kodla koştuğu için bu hatayı **hiçbir mevcut test
// göremezdi**; buradaki mesajlar gerçek üretim hatasının biçimini taşıyor.

/** Üretimde görülen hatanın biçimi: paket kaynağı + asıl veritabanı hatası. */
const URETIM_HATASI = new Error(
  [
    "Invalid `a.orgUnit.findUnique()` invocation in",
    "/app/.next/server/chunks/ssr/[root-of-the-server]__0zyne2a._.js:1:6480",
    '→ 1 module.exports=[82408,a=>{let d=(a)=>a.includes("ORG_TREE_CYCLE")?f("cycle"):' +
      'a.includes("ORG_UNIT_HAS_ACTIVE_USERS")?f("has_active_users"):' +
      'a.includes("USER_INACTIVE_ORG_UNIT")?f("inactive_parent"):f("unknown")}]',
    "Unique constraint failed on the fields: (`email`)",
  ].join("\n"),
);

/** Tetikleyicinin gerçekten attığı hata: `AD: açıklama` biçiminde. */
const TETIKLEYICI_HATASI = new Error(
  "USER_INACTIVE_ORG_UNIT: aktif kullanıcı pasif birime bağlanamaz",
);

describe("kısıt hatası çevirisi", () => {
  it("paket kaynağında geçen dizge kısıt ihlali sayılmaz", () => {
    expect(hasDatabaseSentinel(URETIM_HATASI, "USER_INACTIVE_ORG_UNIT")).toBe(false);
    expect(hasDatabaseSentinel(URETIM_HATASI, "ORG_TREE_CYCLE")).toBe(false);
  });

  it("tetikleyicinin attığı gerçek hata tanınır", () => {
    expect(hasDatabaseSentinel(TETIKLEYICI_HATASI, "USER_INACTIVE_ORG_UNIT")).toBe(true);
  });

  it("başka bir kısıtın adı karışmaz", () => {
    expect(hasDatabaseSentinel(TETIKLEYICI_HATASI, "ORG_TREE_CYCLE")).toBe(false);
  });

  it("tekil kısıt ihlali metinden değil koddan tanınır", () => {
    expect(isUniqueViolation(URETIM_HATASI)).toBe(true);
    expect(isUniqueViolation(TETIKLEYICI_HATASI)).toBe(false);
  });
});

describe("kullanıcı ekleme: üretim biçimli hata", () => {
  // Sahte veritabanı: birim aktif, ayar boş, yazma tekil kısıtla düşüyor.
  const sahteDb = {
    orgUnit: { findUnique: async () => ({ isActive: true }) },
    systemSetting: { findUnique: async () => null },
    user: {},
    auditLog: {},
    $transaction: async () => {
      throw URETIM_HATASI;
    },
  } as unknown as Parameters<typeof createUser>[0];

  it("aynı e-posta 'zaten kayıtlı' der, 'pasif birim' demez", async () => {
    const sonuc = await createUser(sahteDb, {
      fullName: "Kopya Kayıt",
      email: "var@ornek.test",
      orgUnitId: "birim-1",
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: "baslangic-parolasi-1",
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("duplicate_email");
    expect(sonuc.message).toContain("zaten kayıtlı");
  });
});
