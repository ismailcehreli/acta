import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createUser } from "@/server/users/create";
import { updateUser } from "@/server/users/update";
import {
  formatDomainList,
  isEmailDomainAllowed,
  parseDomainList,
} from "@/server/settings/email-domains";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

import { createOrgUnit } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// E-posta alan adı kısıtı (ürün sahibi kararı, 19.08.2026).
//
// Kısıt bir güvenlik duvarı değil, yanlış yazmaya karşı emniyet mandalıdır:
// hesapları zaten sistem yöneticisi açar. Bu yüzden **varsayılanı kapalıdır**
// ve mevcut hesapları etkilemez.

const PAROLA = "kurulum-parolasi-1234";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisitKoy(deger: string) {
  const sonuc = await saveSettings(testDb, {
    [SETTING_KEYS.allowedEmailDomains]: deger,
  });
  if (!sonuc.ok) throw new Error(`ayar yazılamadı: ${sonuc.message}`);
}

describe("liste ayrıştırma", () => {
  it("virgül, boşluk ve satır sonu ayırıcı sayılır", () => {
    const sonuc = parseDomainList("acme.com, ornek.test\nbaska.com.tr");

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.domains).toEqual(["acme.com", "ornek.test", "baska.com.tr"]);
  });

  it("baştaki @ atılır, büyük harf indirgenir, tekrar teke iner", () => {
    const sonuc = parseDomainList("@Acme.COM, acme.com");

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.domains).toEqual(["acme.com"]);
    expect(formatDomainList(sonuc.domains)).toBe("acme.com");
  });

  it("boş metin kısıt yok demektir", () => {
    const sonuc = parseDomainList("   ");

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.domains).toEqual([]);
  });

  it("geçersiz alan adı reddedilir ve hangisi olduğu söylenir", () => {
    const sonuc = parseDomainList("acme.com, nokta_yok");

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.message).toContain("nokta_yok");
  });
});

describe("eşleşme", () => {
  it("boş liste her adrese izin verir", () => {
    expect(isEmailDomainAllowed("kimse@baska.com", [])).toBe(true);
  });

  it("listedeki alan adı kabul edilir, dışındaki edilmez", () => {
    const liste = ["acme.com"];

    expect(isEmailDomainAllowed("ali@acme.com", liste)).toBe(true);
    expect(isEmailDomainAllowed("ali@acme.co", liste)).toBe(false);
  });

  it("alt alan adı eşleşmez", () => {
    // "posta.acme.com" başka bir alan adıdır; gevşek eşleşme, kısıtın
    // amacını (yanlış yazımı yakalamak) bulanıklaştırırdı.
    expect(isEmailDomainAllowed("ali@posta.acme.com", ["acme.com"])).toBe(
      false,
    );
  });
});

describe("ayar defteri", () => {
  it("kaydederken kanonik biçime indirger", async () => {
    await kisitKoy(" @Acme.com ;  ornek.test ");

    const kayit = await testDb.systemSetting.findUniqueOrThrow({
      where: { key: SETTING_KEYS.allowedEmailDomains },
    });
    expect(kayit.value).toBe("acme.com, ornek.test");
  });

  it("geçersiz liste hiç yazılmaz", async () => {
    const sonuc = await saveSettings(testDb, {
      [SETTING_KEYS.allowedEmailDomains]: "bozuk alan adı!",
    });

    expect(sonuc.ok).toBe(false);
    expect(
      await testDb.systemSetting.findUnique({
        where: { key: SETTING_KEYS.allowedEmailDomains },
      }),
    ).toBeNull();
  });
});

describe("hesap açma", () => {
  it("kısıt kapalıyken her adrese hesap açılır", async () => {
    const birim = await createOrgUnit({ name: "Kök", type: "Kök" });

    const sonuc = await createUser(testDb, {
      fullName: "Serbest Kişi",
      email: "kisi@herhangi.test",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PAROLA,
    });

    expect(sonuc.ok).toBe(true);
  });

  it("kısıt dışındaki adrese hesap açılamaz", async () => {
    const birim = await createOrgUnit({ name: "Kök", type: "Kök" });
    await kisitKoy("acme.com");

    const sonuc = await createUser(testDb, {
      fullName: "Yanlış Yazım",
      email: "ali@acme.co",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PAROLA,
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("email_domain_not_allowed");
    // Hangi alan adlarının kabul edildiği söylenmeli.
    expect(sonuc.message).toContain("acme.com");
    // Kayıt gerçekten açılmamış olmalı.
    expect(await testDb.user.count()).toBe(0);
  });

  it("izinli adrese hesap açılır", async () => {
    const birim = await createOrgUnit({ name: "Kök", type: "Kök" });
    await kisitKoy("acme.com, ornek.test");

    const sonuc = await createUser(testDb, {
      fullName: "Doğru Kişi",
      email: "ali@ornek.test",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PAROLA,
    });

    expect(sonuc.ok).toBe(true);
  });
});

describe("adres değiştirme", () => {
  it("kısıt sonradan konsa da eski adresli kullanıcı düzenlenebilir", async () => {
    const birim = await createOrgUnit({ name: "Kök", type: "Kök" });
    const olusturma = await createUser(testDb, {
      fullName: "Eski Kişi",
      email: "eski@baska.test",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PAROLA,
    });
    if (!olusturma.ok) throw new Error("kurulum başarısız");

    await kisitKoy("acme.com");

    // Adres değişmiyor; yalnız ad düzeltiliyor. Kısıt buna takılmamalı —
    // yoksa kısıt konur konmaz eski kullanıcılar donardı.
    const sonuc = await updateUser(testDb, {
      id: olusturma.user.id,
      fullName: "Eski Kişi Düzeltildi",
      email: "eski@baska.test",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(true);
  });

  it("adres kısıt dışına değiştirilemez", async () => {
    const birim = await createOrgUnit({ name: "Kök", type: "Kök" });
    const olusturma = await createUser(testDb, {
      fullName: "Kişi",
      email: "kisi@acme.com",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
      initialPassword: PAROLA,
    });
    if (!olusturma.ok) throw new Error("kurulum başarısız");

    await kisitKoy("acme.com");

    const sonuc = await updateUser(testDb, {
      id: olusturma.user.id,
      fullName: "Kişi",
      email: "kisi@disarida.test",
      orgUnitId: birim.id,
      isUnitManager: false,
      isSystemAdmin: false,
      writesActivities: true,
    });

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("email_domain_not_allowed");

    const guncel = await testDb.user.findUniqueOrThrow({
      where: { id: olusturma.user.id },
    });
    expect(guncel.email).toBe("kisi@acme.com");
  });
});
