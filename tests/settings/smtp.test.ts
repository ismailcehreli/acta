import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { openSecret, sealSecret } from "@/server/crypto/secret-box";
import {
  clearSmtpPassword,
  readSmtpSettings,
  readSmtpView,
  saveSmtpSettings,
} from "@/server/settings/smtp";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// SMTP ayarları ekrandan yönetilir (§12.3, §16.5). Parola **şifreli** saklanır:
// düz yazılsaydı veritabanı yedeğini alan herkes şirketin posta hesabını ele
// geçirirdi.

const SECRET = "test-icin-en-az-otuz-iki-karakterlik-anahtar";
const AYARLAR = {
  host: "posta.ornek.test",
  port: 587,
  secure: false,
  user: "faaliyet",
  from: "Faaliyet <faaliyet@ornek.test>",
};

beforeEach(async () => {
  await resetDatabase();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("sır kutusu", () => {
  it("şifrelenen değer geri çözülür", () => {
    const kapali = sealSecret("gizli-parola", SECRET, "smtp-password");

    expect(kapali).not.toContain("gizli-parola");
    expect(openSecret(kapali, SECRET, "smtp-password")).toBe("gizli-parola");
  });

  it("her şifreleme farklı çıktı verir", () => {
    const bir = sealSecret("aynı-değer", SECRET, "smtp-password");
    const iki = sealSecret("aynı-değer", SECRET, "smtp-password");

    // Rastgele IV: aynı değerin iki kaydı birbirine benzemez.
    expect(bir).not.toBe(iki);
  });

  it("başka anahtar ya da başka amaçla çözülemez", () => {
    const kapali = sealSecret("gizli", SECRET, "smtp-password");

    expect(openSecret(kapali, "baska-anahtar-en-az-otuz-iki-karakterlik", "smtp-password")).toBeNull();
    expect(openSecret(kapali, SECRET, "baska-amac")).toBeNull();
  });

  it("kurcalanmış değer çözülmez", () => {
    const kapali = sealSecret("gizli", SECRET, "smtp-password");
    const parcalar = kapali.split(".");
    const bozuk = `${parcalar[0]}.${parcalar[1]}.${Buffer.from("sahte").toString("base64url")}`;

    expect(openSecret(bozuk, SECRET, "smtp-password")).toBeNull();
    expect(openSecret("bozuk-bicim", SECRET, "smtp-password")).toBeNull();
  });
});

describe("ayarların saklanması", () => {
  it("parola veritabanında düz durmaz", async () => {
    await saveSmtpSettings(testDb, { ...AYARLAR, password: "cok-gizli-parola" }, SECRET);

    const kayitlar = await testDb.systemSetting.findMany();
    const hepsi = kayitlar.map((k) => k.value).join(" ");

    expect(hepsi).not.toContain("cok-gizli-parola");
    // Ama gönderim için çözülebilmeli.
    const ayarlar = await readSmtpSettings(testDb, SECRET);
    expect(ayarlar?.password).toBe("cok-gizli-parola");
  });

  it("parola ekrana geri gönderilmez", async () => {
    await saveSmtpSettings(testDb, { ...AYARLAR, password: "gizli" }, SECRET);

    const view = await readSmtpView(testDb);

    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain("gizli");
    expect(view.host).toBe(AYARLAR.host);
    expect(view.source).toBe("database");
  });

  it("boş parola mevcut olanı korur", async () => {
    await saveSmtpSettings(testDb, { ...AYARLAR, password: "ilk-parola" }, SECRET);
    await saveSmtpSettings(testDb, { ...AYARLAR, port: 465, secure: true }, SECRET);

    const ayarlar = await readSmtpSettings(testDb, SECRET);
    expect(ayarlar?.password).toBe("ilk-parola");
    expect(ayarlar?.port).toBe(465);
    expect(ayarlar?.secure).toBe(true);
  });

  it("parola silinebilir", async () => {
    const birim = await createOrgUnit({ name: "Şirket", type: "Kök" });
    const aktor = await createUser(birim.id, {
      email: "yonetici@ornek.test",
      isSystemAdmin: true,
    });

    await saveSmtpSettings(testDb, { ...AYARLAR, password: "silinecek" }, SECRET);
    await clearSmtpPassword(testDb, aktor.id);

    const view = await readSmtpView(testDb);
    expect(view.hasPassword).toBe(false);
    const ayarlar = await readSmtpSettings(testDb, SECRET);
    expect(ayarlar?.password).toBe("");

    // İz bırakır (§15.2): parolanın silinmesi bildirim kanalını durdurabilir;
    // izsiz kalmamalı (bulgu 14).
    const iz = await testDb.auditLog.findFirstOrThrow({
      where: { action: "smtp_password_cleared" },
    });
    expect(iz.userId).toBe(aktor.id);
  });

  it("çözülemeyen parola sessizce boş sayılmaz", async () => {
    await saveSmtpSettings(testDb, { ...AYARLAR, password: "gizli" }, SECRET);

    // Anahtar değişmiş gibi davranılır.
    const ayarlar = await readSmtpSettings(
      testDb,
      "tamamen-baska-bir-anahtar-en-az-otuz-iki",
    );

    // Boş parolayla bağlanmayı denemek yerine ayar yok sayılır.
    expect(ayarlar).toBeNull();
  });
});

describe("kaynak önceliği", () => {
  it("kayıt yokken ortam değişkenleri kullanılır", async () => {
    process.env.SMTP_HOST = "ortam.ornek.test";
    process.env.SMTP_FROM = "ortam@ornek.test";

    const view = await readSmtpView(testDb);
    expect(view.source).toBe("environment");
    expect(view.host).toBe("ortam.ornek.test");

    const ayarlar = await readSmtpSettings(testDb, SECRET);
    expect(ayarlar?.host).toBe("ortam.ornek.test");
  });

  it("veritabanı kaydı ortamın yerini alır", async () => {
    process.env.SMTP_HOST = "ortam.ornek.test";
    process.env.SMTP_FROM = "ortam@ornek.test";
    await saveSmtpSettings(testDb, AYARLAR, SECRET);

    const ayarlar = await readSmtpSettings(testDb, SECRET);
    expect(ayarlar?.host).toBe(AYARLAR.host);
  });

  it("hiçbiri yoksa gönderim ayarı yoktur", async () => {
    expect(await readSmtpSettings(testDb, SECRET)).toBeNull();
    expect((await readSmtpView(testDb)).source).toBe("none");
  });

  it("gönderen adresi eksikse ayar geçersizdir", async () => {
    await saveSmtpSettings(testDb, { ...AYARLAR, from: "" }, SECRET);

    // Adres var ama gönderen yok: posta gönderilemez, sessizce denenmemeli.
    expect(await readSmtpSettings(testDb, SECRET)).toBeNull();
  });
});
