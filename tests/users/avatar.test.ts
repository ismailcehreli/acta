import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { avatarToneIndex } from "@/shared/format/avatar-tone";
import {
  AVATAR_MAX_BYTES,
  initials,
  readAvatar,
  removeAvatar,
  saveAvatar,
} from "@/server/users/avatar";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Profil resmi (Görev 11.5).
//
// İki kural pazarlığa kapalı:
//
//   1. Tür **içerik imzasından** doğrulanır, uzantıdan değil (§15.4). Uzantısı
//      `.png` olan bir SVG ya da çalıştırılabilir buradan geçemez.
//   2. SVG **kabul edilmez.** Marka logosunda kabul ediliyor çünkü onu tek bir
//      sistem yöneticisi yüklüyor; avatarı herkes yüklüyor ve SVG betik
//      taşıyabilir.

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000a49444154789c6300010000050001" +
    "0d0a2db40000000049454e44ae426082",
  "hex",
);

const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

let depo: string;

beforeEach(async () => {
  await resetDatabase();
  depo = await mkdtemp(path.join(tmpdir(), "avatar-testi-"));
  process.env.AVATAR_STORAGE_DIR = depo;
});

afterEach(async () => {
  await rm(depo, { recursive: true, force: true });
  delete process.env.AVATAR_STORAGE_DIR;
});

async function kisi() {
  const unit = await createOrgUnit({ name: "Kalıphane", type: "Kök" });
  return createUser(unit.id, { fullName: "Kadir Usta" });
}

describe("tür doğrulaması", () => {
  it("PNG kabul edilir ve uzantı kaydedilir", async () => {
    const kadir = await kisi();

    const sonuc = await saveAvatar(testDb, kadir.id, PNG);

    expect(sonuc.ok).toBe(true);
    const guncel = await testDb.user.findUnique({ where: { id: kadir.id } });
    expect(guncel?.avatarExtension).toBe("png");
  });

  it("JPEG kabul edilir", async () => {
    const kadir = await kisi();

    expect((await saveAvatar(testDb, kadir.id, JPEG)).ok).toBe(true);
  });

  // SVG betik taşıyabilir ve avatarı herkes yüklüyor.
  it("SVG reddedilir", async () => {
    const kadir = await kisi();

    const sonuc = await saveAvatar(testDb, kadir.id, SVG);

    expect(sonuc.ok).toBe(false);
    const guncel = await testDb.user.findUnique({ where: { id: kadir.id } });
    expect(guncel?.avatarExtension).toBeNull();
  });

  // Tür uzantıdan değil içerik imzasından okunuyor: dosyanın adı ne olursa
  // olsun içeriği ne ise o geçerli.
  it("resim olmayan içerik reddedilir", async () => {
    const kadir = await kisi();

    const sonuc = await saveAvatar(testDb, kadir.id, Buffer.from("MZ\x90\x00"));

    expect(sonuc.ok).toBe(false);
  });

  it("boş dosya reddedilir", async () => {
    const kadir = await kisi();

    expect((await saveAvatar(testDb, kadir.id, Buffer.alloc(0))).ok).toBe(false);
  });

  it("boyut sınırını aşan dosya reddedilir", async () => {
    const kadir = await kisi();
    const buyuk = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);

    const sonuc = await saveAvatar(testDb, kadir.id, buyuk);

    expect(sonuc.ok).toBe(false);
  });
});

describe("saklama", () => {
  it("yüklenen dosya geri okunur", async () => {
    const kadir = await kisi();
    await saveAvatar(testDb, kadir.id, PNG);

    const okunan = await readAvatar(kadir.id, "png");

    expect(okunan?.equals(PNG)).toBe(true);
  });

  // Yeni resim eskisinin yerine geçer; depoda iki dosya birikmez.
  it("ikinci yükleme eskisini değiştirir", async () => {
    const kadir = await kisi();
    await saveAvatar(testDb, kadir.id, PNG);
    await saveAvatar(testDb, kadir.id, JPEG);

    const guncel = await testDb.user.findUnique({ where: { id: kadir.id } });
    expect(guncel?.avatarExtension).toBe("jpg");
    // Eski uzantıyla dosya kalmamalı.
    await expect(readFile(path.join(depo, `${kadir.id}.png`))).rejects.toThrow();
  });

  it("kaldırılınca alan boşalır ve dosya silinir", async () => {
    const kadir = await kisi();
    await saveAvatar(testDb, kadir.id, PNG);

    await removeAvatar(testDb, kadir.id);

    const guncel = await testDb.user.findUnique({ where: { id: kadir.id } });
    expect(guncel?.avatarExtension).toBeNull();
    expect(await readAvatar(kadir.id, "png")).toBeNull();
  });

  // Yol, kullanıcı kimliğinden üretiliyor; yine de kök dışına çıkılamamalı.
  it("kimlik yerine yol parçası verilirse okuma yapılmaz", async () => {
    expect(await readAvatar("../../etc/passwd", "png")).toBeNull();
  });
});

describe("baş harfler", () => {
  it("ad ve soyadın baş harflerini verir", () => {
    expect(initials("Ahmet Yılmaz")).toBe("AY");
  });

  it("tek kelimelik adda tek harf verir", () => {
    expect(initials("Ahmet")).toBe("A");
  });

  it("üç kelimede ilk ve son kelimeyi kullanır", () => {
    expect(initials("Ahmet Can Yılmaz")).toBe("AY");
  });

  it("Türkçe harfleri büyütürken bozmaz", () => {
    // "ışık" → "I", İngilizce büyütme "i" için yanlış harf üretir.
    expect(initials("ışık ırmak")).toBe("II");
    expect(initials("İnci Şahin")).toBe("İŞ");
  });

  it("boş adda boş metin döner, çökmez", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });
});

describe("baş harf rengi", () => {
  // Renk kimlikten türetiliyor: aynı kişi her ekranda aynı renkte görünmeli,
  // yoksa göz onu bir işaret olarak kullanamaz.
  it("aynı kimlik her zaman aynı tonu verir", () => {
    const a = avatarToneIndex("3f2a9c1e-0000-4000-8000-000000000001");
    const b = avatarToneIndex("3f2a9c1e-0000-4000-8000-000000000001");

    expect(a).toBe(b);
  });

  it("ton sayısı sınırların içinde kalır", () => {
    for (const id of ["a", "bb", "ccc", "3f2a9c1e-0000-4000-8000-000000000009"]) {
      const ton = avatarToneIndex(id);
      expect(ton).toBeGreaterThanOrEqual(0);
      expect(ton).toBeLessThan(6);
    }
  });

  it("boş kimlikte de geçerli bir ton verir", () => {
    expect(avatarToneIndex("")).toBe(0);
  });
});
