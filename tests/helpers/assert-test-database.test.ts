import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertTestDatabaseUrl,
  canonicalTarget,
  maskUrl,
} from "./assert-test-database";

// Bu koruma, testlerin yanlış veritabanını boşaltmasını engelliyor. Korumanın
// kendisi test edilmezse "koruma var" demek bir iddiadan ibaret kalır
// (denetim 17.08.2026, bulgu 3).

const TEST_URL = "postgresql://u:p@localhost:5433/faaliyet_test";
const APP_URL = "postgresql://u:p@localhost:5442/faaliyet";

const options = { variableName: "TEST_DATABASE_URL", applicationUrl: APP_URL };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test veritabanı doğrulaması", () => {
  it("izinli test veritabanını kabul eder", () => {
    expect(assertTestDatabaseUrl(TEST_URL, options)).toBe(TEST_URL);
  });

  it("uçtan uca veritabanını da kabul eder", () => {
    const e2eUrl = "postgresql://u:p@localhost:5433/faaliyet_e2e";
    expect(assertTestDatabaseUrl(e2eUrl, options)).toBe(e2eUrl);
  });

  it("adres verilmezse durur", () => {
    expect(() => assertTestDatabaseUrl(undefined, options)).toThrow(
      /tanımlı değil/,
    );
  });

  it("uygulamanın veritabanını reddeder", () => {
    expect(() => assertTestDatabaseUrl(APP_URL, options)).toThrow(
      /DATABASE_URL değeriyle aynı/,
    );
  });

  it("adı 'test' içeren ama izinli olmayan veritabanını reddeder", () => {
    // Eski koruma yalnızca "test" kelimesi arıyordu; bu adres onu geçerdi.
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5433/latest", options),
    ).toThrow(/izinli bir test veritabanına işaret etmiyor/);
  });

  it("üretim veritabanı adını reddeder", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5433/faaliyet", options),
    ).toThrow(/izinli bir test veritabanına işaret etmiyor/);
  });

  it("uzak sunucuyu reddeder", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://u:p@db.sirket.local:5432/faaliyet_test",
        options,
      ),
    ).toThrow(/yerel olmayan bir sunucuya işaret ediyor/);
  });

  it("üretim ortamında hiç çalışmaz", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertTestDatabaseUrl(TEST_URL, options)).toThrow(
      /üretim ortamında/,
    );
  });

  it("hata mesajı parolayı açığa çıkarmaz", () => {
    const withPassword = "postgresql://faaliyet:gizli-parola@localhost:5442/faaliyet";

    expect(maskUrl(withPassword)).not.toContain("gizli-parola");
    expect(maskUrl(withPassword)).toContain("***");

    try {
      assertTestDatabaseUrl(withPassword, {
        variableName: "TEST_DATABASE_URL",
        applicationUrl: withPassword,
      });
      throw new Error("hata bekleniyordu");
    } catch (error) {
      expect((error as Error).message).not.toContain("gizli-parola");
    }
  });
});

// Denetim FAZ 2, bulgu 6: karşılaştırma iki ham metni `===` ile
// eşleştiriyordu; aynı veritabanı farklı URL biçimiyle guard'dan geçebiliyordu.
describe("aynı hedefi farklı yazımla tanır", () => {
  it("localhost ile 127.0.0.1 aynı hedef sayılır", () => {
    expect(canonicalTarget("postgresql://u:p@localhost:5442/faaliyet")).toBe(
      canonicalTarget("postgresql://baska:parola@127.0.0.1:5442/faaliyet"),
    );
  });

  it("yazılmamış varsayılan port yazılmışla aynı hedeftir", () => {
    expect(canonicalTarget("postgresql://u:p@127.0.0.1/faaliyet")).toBe(
      canonicalTarget("postgresql://u:p@127.0.0.1:5432/faaliyet"),
    );
  });

  it("uygulama veritabanı başka bir yazımla verilse de reddedilir", () => {
    // Eski kontrol bunu kaçırıyordu: metinler farklı, hedef aynı.
    expect(() =>
      assertTestDatabaseUrl("postgresql://u:p@localhost:5442/faaliyet", {
        variableName: "TEST_DATABASE_URL",
        applicationUrl: "postgresql://faaliyet:parola@127.0.0.1:5442/faaliyet",
      }),
    ).toThrow(/aynı veritabanını gösteriyor|izinli bir test veritabanına/);
  });

  it("farklı veritabanı adı farklı hedeftir", () => {
    expect(canonicalTarget("postgresql://u:p@127.0.0.1:5433/faaliyet_test")).not.toBe(
      canonicalTarget("postgresql://u:p@127.0.0.1:5433/faaliyet_e2e"),
    );
  });
});
