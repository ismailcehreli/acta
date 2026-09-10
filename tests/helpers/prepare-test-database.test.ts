import { describe, expect, it } from "vitest";

import { prepareTestDatabase } from "./prepare-test-database";

// Korumanın değeri sırada: işaret taşımayan bir veritabanına migration
// **hiç uygulanmamalı**. Önceki düzeltme boşaltmayı korumuş, migration yolunu
// korumamıştı — göç şema değiştirir ve veri dönüştürür; sonrasında durmak
// hasarı geri almaz (denetim 18.08.2026, FAZ 4 bulgu 12).

function izleyici() {
  const sira: string[] = [];
  let schemaSaglam = true;
  return {
    sira,
    resolveUrl: () => {
      sira.push("adres");
      return "postgresql://test/faaliyet_test";
    },
    assertSentinel: async () => {
      sira.push("isaret");
    },
    runMigrations: () => {
      sira.push("migration");
    },
    isSchemaReady: async () => {
      sira.push("sema");
      return schemaSaglam;
    },
    resetDatabase: () => {
      sira.push("reset");
      schemaSaglam = true;
    },
  };
}

describe("test veritabanı hazırlığı", () => {
  it("adres, işaret, migration sırasıyla ilerler", async () => {
    const adimlar = izleyici();

    await prepareTestDatabase(adimlar);

    expect(adimlar.sira).toEqual(["adres", "isaret", "migration", "sema"]);
  });

  it("işaret yoksa migration hiç çalışmaz", async () => {
    const adimlar = izleyici();

    await expect(
      prepareTestDatabase({
        ...adimlar,
        assertSentinel: async () => {
          adimlar.sira.push("isaret");
          throw new Error("Hedef veritabanında test işareti yok.");
        },
      }),
    ).rejects.toThrow(/test işareti yok/);

    expect(adimlar.sira).toEqual(["adres", "isaret"]);
    expect(adimlar.sira).not.toContain("migration");
  });

  it("adres reddedilirse işaret bile aranmaz", async () => {
    const adimlar = izleyici();

    await expect(
      prepareTestDatabase({
        ...adimlar,
        resolveUrl: () => {
          adimlar.sira.push("adres");
          throw new Error("Test veritabanı adresi geçersiz.");
        },
      }),
    ).rejects.toThrow(/adresi geçersiz/);

    expect(adimlar.sira).toEqual(["adres"]);
  });

  it("migration geçmişi varken şema eksikse yalnız doğrulanmış test hedefini resetler", async () => {
    const adimlar = izleyici();
    let ilkKontrol = true;

    await prepareTestDatabase({
      ...adimlar,
      isSchemaReady: async () => {
        adimlar.sira.push("sema");
        if (ilkKontrol) {
          ilkKontrol = false;
          return false;
        }
        return true;
      },
    });

    expect(adimlar.sira).toEqual([
      "adres", "isaret", "migration", "sema", "reset", "sema",
    ]);
  });

  it("reset sonrası da eksik şema varsa uygulama sunucusundan önce açık hata verir", async () => {
    const adimlar = izleyici();

    await expect(
      prepareTestDatabase({
        ...adimlar,
        isSchemaReady: async () => {
          adimlar.sira.push("sema");
          return false;
        },
      }),
    ).rejects.toThrow(/zorunlu tabloları hâlâ eksik/);

    expect(adimlar.sira).toEqual([
      "adres", "isaret", "migration", "sema", "reset", "sema",
    ]);
  });
});
