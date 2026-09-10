import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §15.4: dosya eki güvenliği. Tür uzantıdan değil içerikten doğrulanır,
// saklama adı sunucuda üretilir, indirme görünürlükten geçer.

const NOW = new Date("2026-08-17T09:00:00.000Z");

let storageDir: string;

beforeAll(async () => {
  // Depo geçici bir dizine kurulur: testler gerçek depoya yazmaz.
  storageDir = await mkdtemp(path.join(tmpdir(), "ek-testi-"));
  process.env.ATTACHMENT_STORAGE_DIR = storageDir;
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  await testDb.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Gerçek dosyalar: tür içerikten okunuyor mu, ancak böyle sınanır. */
// 1×1 piksel PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 2)]);
/** Windows çalıştırılabilir dosya imzası. */
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(128, 3)]);
/**
 * Asgari ama **gerçek** bir MP4 başlığı (`ftyp` kutusu, isom markası). Tür
 * doğrulaması içerik imzasına baktığı için uydurma bayt yeterli olmaz.
 */
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2"),
  Buffer.alloc(32, 0),
]);

async function scenario() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const moldShop = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planlama", parentId: root.id });

  const manager = await createUser(moldShop.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, { fullName: "Çalışan" });
  const peer = await createUser(planning.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Kalıp bakımı",
      description: "Açıklama",
      approvalStatus: "APPROVED",
    },
  });

  return { manager, author, peer, activity };
}

const viewer = (user: { id: string }) => ({ id: user.id, isSystemAdmin: false });

describe("tür doğrulama içerikten yapılır (§15.4)", () => {
  it("uzantısı pdf olan çalıştırılabilir dosya reddedilir", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "rapor.pdf", content: EXE }],
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("unsupported_type");
    expect(await testDb.attachment.count()).toBe(0);
  });

  it("gerçek PDF kabul edilir ve türü içerikten yazılır", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "rapor.txt", content: PDF }],
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    // Uzantı .txt olsa da tür içerikten belirlenir.
    expect(sonuc.value[0].mimeType).toBe("application/pdf");
  });

  it("video kabul edilir (ürün sahibi kararı, 03.09.2026)", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "hat-kaydi.mp4", content: MP4 }],
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value[0].mimeType).toBe("video/mp4");
  });

  it("boş dosya reddedilir", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "bos.pdf", content: Buffer.alloc(0) }],
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("empty_file");
  });
});

describe("saklama adı ve bütünlük", () => {
  it("kullanıcının verdiği ad diske yazılmaz", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "../../etc/passwd.png", content: PNG }],
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const ek = sonuc.value[0];
    // Orijinal ad yalnızca veritabanında durur; saklama adı yol ayırıcı
    // içermez, dolayısıyla yol enjeksiyonu imkânsızdır.
    expect(ek.originalName).toBe("../../etc/passwd.png");
    expect(ek.storedName).toMatch(/^[a-f0-9]+$/);
    expect(ek.storedName).not.toContain("/");
    expect(ek.storagePath).not.toContain("..");
  });

  it("SHA-256 özeti saklanır", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { sha256Of } = await import("@/server/attachments/storage");
    const { author, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "resim.png", content: PNG }],
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value[0].sha256).toBe(sha256Of(PNG));
  });

  // Denetim 21.08.2026, bulgu 9: özet yükleme sırasında hesaplanıp
  // saklanıyor ama indirmede **hiçbir karar vermiyordu**. Bütünlük alanı,
  // bütünlük kontrolü yapmadığı sürece süstür.
  it("depodaki dosya değiştirilmişse indirilmez", async () => {
    const { attachFiles, loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { author, activity } = await scenario();

    const yuklenen = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "resim.png", content: PNG }],
      NOW,
    );
    if (!yuklenen.ok) throw new Error("kurulum");
    const ek = yuklenen.value[0];

    // Kontrol: bozulmadan önce indirilebiliyor.
    const once = await loadAttachmentForDownload(
      testDb,
      { id: author.id, isSystemAdmin: false },
      ek.id,
    );
    expect(once.ok).toBe(true);

    // Dosya sunucu tarafında değiştiriliyor: depo bozulması ya da müdahale.
    const { writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const kok =
      process.env.ATTACHMENT_STORAGE_DIR ??
      path.join(process.cwd(), "storage", "attachments");
    await writeFile(path.resolve(kok, ek.storagePath), Buffer.from("baska icerik"));

    const sonra = await loadAttachmentForDownload(
      testDb,
      { id: author.id, isSystemAdmin: false },
      ek.id,
    );

    expect(sonra.ok).toBe(false);
    if (sonra.ok) return;
    expect(sonra.error).toBe("integrity_failed");
  });
});

describe("sınırlar (§5.2)", () => {
  it("beş dosya kabul edilir, altıncı reddedilir", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const bes = Array.from({ length: 5 }, (_, index) => ({
      originalName: `dosya-${index}.png`,
      content: PNG,
    }));

    expect((await attachFiles(testDb, author.id, activity.id, bes, NOW)).ok).toBe(
      true,
    );

    const altinci = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "altinci.png", content: PNG }],
      NOW,
    );

    expect(altinci.ok).toBe(false);
    if (altinci.ok) return;
    expect(altinci.error).toBe("too_many");
    expect(await testDb.attachment.count()).toBe(5);
  });

  it("boyut sınırı ayardan okunur", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { SETTING_KEYS } = await import("@/server/settings/system-settings");
    const { author, activity } = await scenario();

    // Sınır 1 MB'a çekilir; ayarlar tam sayı MB kabul eder (§16.5 kayıt
    // defteri). Dosya sınırın üstünde olacak kadar büyük üretilir.
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.attachmentMaxMb,
        value: "1",
        description: "Ek dosya azami boyut (MB)",
      },
    });

    const buyukDosya = Buffer.concat([
      PNG,
      Buffer.alloc(2 * 1024 * 1024, 0),
    ]);

    const sonuc = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "resim.png", content: buyukDosya }],
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("too_large");
  });

  it("başkasının faaliyetine ek yüklenemez", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { manager, activity } = await scenario();

    const sonuc = await attachFiles(
      testDb,
      manager.id,
      activity.id,
      [{ originalName: "resim.png", content: PNG }],
      NOW,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.message).toBe("Faaliyet bulunamadı.");
  });
});

describe("indirme görünürlükten geçer (§15.4)", () => {
  async function ekliFaaliyet() {
    const { attachFiles } = await import("@/server/attachments/service");
    const context = await scenario();
    const sonuc = await attachFiles(
      testDb,
      context.author.id,
      context.activity.id,
      [{ originalName: "resim.png", content: PNG }],
      NOW,
    );
    if (!sonuc.ok) throw new Error("kurulum");
    return { ...context, attachment: sonuc.value[0] };
  }

  it("yazan kendi ekini indirebilir", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { author, attachment } = await ekliFaaliyet();

    const sonuc = await loadAttachmentForDownload(
      testDb,
      viewer(author),
      attachment.id,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value.content.equals(PNG)).toBe(true);
  });

  it("faaliyeti görebilen üst kademe ekini de indirebilir", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { manager, attachment } = await ekliFaaliyet();

    expect(
      (await loadAttachmentForDownload(testDb, viewer(manager), attachment.id)).ok,
    ).toBe(true);
  });

  it("faaliyeti göremeyen ekini de indiremez", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { peer, attachment } = await ekliFaaliyet();

    const sonuc = await loadAttachmentForDownload(
      testDb,
      viewer(peer),
      attachment.id,
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    // Dosyanın varlığı da bildirilmez.
    expect(sonuc.message).toBe("Dosya bulunamadı.");
  });

  it("iptal edilen faaliyetin eki silinmez, erişim faaliyeti izler", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { author, manager, peer, activity, attachment } = await ekliFaaliyet();

    const { cancelActivity } = await import("@/server/activities/cancel");
    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Yanlış girildi.",
      NOW,
    );

    // Dosya duruyor ve faaliyeti görenler hâlâ indirebiliyor.
    expect(await testDb.attachment.count()).toBe(1);
    expect(
      (await loadAttachmentForDownload(testDb, viewer(manager), attachment.id)).ok,
    ).toBe(true);
    // Göremeyen yine göremiyor.
    expect(
      (await loadAttachmentForDownload(testDb, viewer(peer), attachment.id)).ok,
    ).toBe(false);
  });
});
