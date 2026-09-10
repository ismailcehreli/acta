import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { markNoActivityPeriod } from "@/server/absence/service";
import { createReason } from "@/server/approval-reasons/service";
import { isExclusionViolation, isUniqueViolation } from "@/server/db-errors";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Paketlenmiş kaynak metni **ihlal değildir** (denetim 23.08.2026,
// bulgu 11).
//
// `db-errors.ts` bu tuzağı bir kez kapattı ama iki eski çevirici çıplak metin
// aramaya devam ediyordu:
//
//   · gerekçe kataloğu: `includes("Unique constraint") || includes("23505")`
//   · devamsızlık: `includes("NoActivityPeriod_no_overlap")`
//
// Minifiye sunucu paketinde bu dizgeler **aynı modülün kaynağında** bulunuyor.
// Prisma başka bir hata için çağrı kaynağını mesaja eklediğinde gerekçe
// servisi onu "mükerrer etiket", devamsızlık servisi "çakışma" diye
// çeviriyordu: kullanıcıya yanlış ve eyleme geçirilemez bir iş kuralı mesajı.
//
// Testler bundle'lanmamış kodla koştuğu için bu hatayı hiçbir mevcut test
// göremezdi; buradaki hatalar gerçek üretim biçimini taşıyor.

/** Paket kaynağı + altta **başka** bir veritabanı hatası. */
function uretimHatasi(kaynakSatiri: string, asilHata: string): Error {
  return new Error(
    [
      "Invalid `a.approvalReason.create()` invocation in",
      "/app/.next/server/chunks/ssr/[root-of-the-server]__0zyne2a._.js:1:6480",
      `→ 1 module.exports=[82408,a=>{${kaynakSatiri}}]`,
      asilHata,
    ].join("\n"),
  );
}

/** Yazma anında patlayan bir istemci; hata biçimi dışarıdan verilir. */
function patlayanDb(hata: Error) {
  return new Proxy(testDb, {
    get(hedef, alan) {
      if (alan === "$transaction") {
        return () => Promise.reject(hata);
      }

      const deger = Reflect.get(hedef, alan);
      return typeof deger === "function" ? deger.bind(hedef) : deger;
    },
  }) as unknown as typeof testDb;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("gerekçe kataloğu", () => {
  const KAYNAK = 'let d=(a)=>a.includes("Unique constraint")||a.includes("23505")?f("duplicate_label"):f("unknown")';

  it("paket kaynağındaki dizge mükerrer etiket sayılmaz", async () => {
    const hata = uretimHatasi(
      KAYNAK,
      // Asıl hata **tekillik değil**: bağlantı düştü.
      "Server has closed the connection.",
    );

    const sonuc = await createReason(
      patlayanDb(hata),
      { kind: "REJECTED", label: "Yeni gerekçe", sortOrder: 10 },
      "aktor",
    );

    expect(sonuc.ok).toBe(false);
    if (!sonuc.ok) expect(sonuc.error).toBe("unknown");
  });

  it("gerçek tekillik ihlali mükerrer etiket olarak çevrilir", async () => {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const yonetici = await createUser(kok.id, { isSystemAdmin: true });

    await createReason(
      testDb,
      { kind: "REJECTED", label: "Aynı etiket", sortOrder: 10 },
      yonetici.id,
    );

    const ikinci = await createReason(
      testDb,
      { kind: "REJECTED", label: "Aynı etiket", sortOrder: 20 },
      yonetici.id,
    );

    expect(ikinci.ok).toBe(false);
    if (!ikinci.ok) expect(ikinci.error).toBe("duplicate_label");
  });
});

describe("devamsızlık çakışması", () => {
  const KAYNAK = 'let d=(a)=>a.includes("NoActivityPeriod_no_overlap")?f("overlaps"):g(a)';

  async function ekip() {
    const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const birim = await createOrgUnit({ name: "Kalıphane", parentId: kok.id });
    const mudur = await createUser(birim.id, {
      fullName: "Müdür",
      isUnitManager: true,
    });
    const kadir = await createUser(birim.id, { fullName: "Kadir" });
    return { mudur, kadir };
  }

  it("paket kaynağındaki dizge çakışma sayılmaz", async () => {
    const { mudur, kadir } = await ekip();
    const hata = uretimHatasi(KAYNAK, "Server has closed the connection.");

    // Çeviri yanlış dalı seçerse "çakışıyor" der; doğrusu hatanın
    // yutulmaması, yani dışarı fırlaması.
    await expect(
      markNoActivityPeriod(
        patlayanDb(hata),
        mudur.id,
        {
          userId: kadir.id,
          startDate: "2026-08-03",
          endDate: "2026-08-05",
          note: "İzin",
        },
        new Date("2026-08-01T09:00:00.000Z"),
      ),
    ).rejects.toThrow(/closed the connection/);
  });

  it("gerçek çakışma kısıtı çakışma olarak çevrilir", async () => {
    const { mudur, kadir } = await ekip();
    const donem = {
      userId: kadir.id,
      startDate: "2026-08-03",
      endDate: "2026-08-05",
      note: "İzin",
    };

    const ilk = await markNoActivityPeriod(
      testDb,
      mudur.id,
      donem,
      new Date("2026-08-01T09:00:00.000Z"),
    );
    expect(ilk.ok).toBe(true);

    const ikinci = await markNoActivityPeriod(
      testDb,
      mudur.id,
      donem,
      new Date("2026-08-01T10:00:00.000Z"),
    );

    expect(ikinci.ok).toBe(false);
    if (!ikinci.ok) expect(ikinci.error).toBe("overlaps");
  });
});

describe("dışlama kısıtı tanıma", () => {
  it("kodu ve kısıt adını birlikte arar", () => {
    const gercek = new Error(
      'ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "23P01", ' +
        'message: "conflicting key value violates exclusion constraint ' +
        '\\"NoActivityPeriod_no_overlap\\"" }) })',
    );

    expect(isExclusionViolation(gercek, "NoActivityPeriod_no_overlap")).toBe(true);
    expect(isExclusionViolation(gercek, "Baska_kisit")).toBe(false);
  });

  it("paket kaynağındaki çıplak ad yetmez", () => {
    const paket = new Error(
      'module.exports=[1,a=>a.includes("NoActivityPeriod_no_overlap")?f("overlaps"):0]\n' +
        "Server has closed the connection.",
    );

    expect(isExclusionViolation(paket, "NoActivityPeriod_no_overlap")).toBe(false);
  });

  it("tekillik ihlali dışlama ihlali sayılmaz", () => {
    const tekillik = new Error(
      'PostgresError { code: "23505", message: "duplicate key value" }',
    );

    expect(isExclusionViolation(tekillik, "NoActivityPeriod_no_overlap")).toBe(false);
    expect(isUniqueViolation(tekillik)).toBe(false);
  });
});
