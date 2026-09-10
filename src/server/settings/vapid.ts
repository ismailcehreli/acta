import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { appSecret } from "@/server/auth/config";
import { openSecret, sealSecret } from "@/server/crypto/secret-box";

// Web push için VAPID anahtar çifti (§12.3, Görev 5.3b).
//
// Anahtar çifti **bir kez** üretilir ve sabit kalmak zorundadır: değişirse
// tarayıcılardaki bütün abonelikler geçersizleşir ve herkesin izni yeniden
// vermesi gerekir. Bu yüzden üretme işlemi ayrı bir eylemdir, uygulama
// açılışında kendiliğinden olmaz.
//
// Özel anahtar SMTP parolasıyla aynı biçimde **mühürlü** saklanır: düz
// yazılsaydı veritabanı yedeğini alan herkes şirketin adına bildirim
// gönderebilirdi. Açık anahtar sır değildir; tarayıcıya verilir.

const SEAL_PURPOSE = "vapid-private-key";

const KEYS = {
  publicKey: "vapid_public_key",
  privateKey: "vapid_private_key_sealed",
  subject: "vapid_subject",
} as const;

export type VapidDb = Pick<
  PrismaClient,
  "systemSetting" | "auditLog" | "$transaction"
>;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** `mailto:` adresi; push servisleri sorun çıkınca buraya yazar. */
  subject: string;
}

/** Ekranda gösterilecek hâli; özel anahtar taşımaz. */
export interface VapidView {
  configured: boolean;
  publicKey: string;
  subject: string;
}

const DEFAULT_SUBJECT = "mailto:bt@ornek.test";

async function readMap(db: VapidDb): Promise<Map<string, string>> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function readVapidView(db: VapidDb): Promise<VapidView> {
  const map = await readMap(db);
  const publicKey = map.get(KEYS.publicKey) ?? "";

  return {
    configured: publicKey !== "" && (map.get(KEYS.privateKey) ?? "") !== "",
    publicKey,
    subject: map.get(KEYS.subject) ?? DEFAULT_SUBJECT,
  };
}

/** Tarayıcıya verilecek açık anahtar; kurulu değilse `null`. */
export async function readVapidPublicKey(db: VapidDb): Promise<string | null> {
  const map = await readMap(db);
  const publicKey = map.get(KEYS.publicKey) ?? "";
  if (publicKey === "" || (map.get(KEYS.privateKey) ?? "") === "") return null;
  return publicKey;
}

/**
 * Gönderim için tam anahtarlar. Kurulu değilse ya da özel anahtar
 * çözülemiyorsa `null` döner — sessizce bir varsayılana düşmek, bildirimin
 * gittiğini sanıp gitmemesi demek olurdu.
 */
export async function readVapidKeys(
  db: VapidDb,
  secret: string = appSecret(),
): Promise<VapidKeys | null> {
  const map = await readMap(db);
  const publicKey = map.get(KEYS.publicKey) ?? "";
  const sealed = map.get(KEYS.privateKey) ?? "";

  if (publicKey === "" || sealed === "") return null;

  const privateKey = openSecret(sealed, secret, SEAL_PURPOSE);
  if (privateKey === null) {
    console.error(
      "[push] VAPID özel anahtarı çözülemedi (APP_SECRET değişmiş olabilir). " +
        "Bildirim gönderilmiyor.",
    );
    return null;
  }

  return {
    publicKey,
    privateKey,
    subject: map.get(KEYS.subject) ?? DEFAULT_SUBJECT,
  };
}

export type SaveVapidResult =
  | { ok: true; publicKey: string; replaced: boolean }
  | { ok: false; message: string };

/**
 * Anahtar çifti üretir ve saklar.
 *
 * **Mevcut çift varsa üzerine yazmaz** — `replace` açıkça istenmelidir.
 * Kazara yenilemek bütün abonelikleri sessizce öldürürdü; kimse bildirim
 * almadığını da fark etmezdi.
 */
/**
 * Yalnız iletişim adresini günceller; anahtarlara **dokunmaz**.
 *
 * Eskiden adres yalnız `generateVapidKeys` içinden yazılabiliyordu ve o
 * fonksiyon "zaten anahtar var" diye reddediyordu. Sonuç: kurulum
 * tamamlandıktan sonra adresi değiştirmenin tek yolu bütün abonelikleri
 * öldüren "yenile" seçeneğiydi (21.08.2026, ürün sahibi bildirdi). İki işlem
 * ayrıldı: adres değiştirmek zararsız, anahtar yenilemek yıkıcı.
 */
export type SaveSubjectResult =
  | { ok: true }
  | { ok: false; message: string };

export async function saveVapidSubject(
  db: VapidDb,
  subject: string,
  actorId: string,
  now: Date = new Date(),
): Promise<SaveSubjectResult> {
  const temiz = subject.trim();
  if (!/^mailto:.+@.+\..+/.test(temiz)) {
    return {
      ok: false,
      message: "İletişim adresi 'mailto:' ile başlamalı, örn. mailto:bt@sirket.com",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: KEYS.subject },
      update: { value: temiz },
      create: { key: KEYS.subject, value: temiz, description: "Web push VAPID" },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "vapid",
      action: AUDIT_ACTIONS.settingsChanged,
      now,
    });
  });

  return { ok: true };
}

export async function generateVapidKeys(
  db: VapidDb,
  options: { subject: string; replace?: boolean },
  actorId: string,
  now: Date = new Date(),
  secret: string = appSecret(),
): Promise<SaveVapidResult> {
  const subject = options.subject.trim();
  if (!/^mailto:.+@.+\..+/.test(subject)) {
    return {
      ok: false,
      message: "İletişim adresi 'mailto:' ile başlamalı, örn. mailto:bt@sirket.com",
    };
  }

  const mevcut = await readVapidView(db);
  if (mevcut.configured && !options.replace) {
    return {
      ok: false,
      message:
        "Zaten bir anahtar çifti var. Yenilemek mevcut bütün abonelikleri geçersiz kılar; onay kutusunu işaretleyin.",
    };
  }

  const uretilen = webpush.generateVAPIDKeys();
  const sealed = sealSecret(uretilen.privateKey, secret, SEAL_PURPOSE);

  await db.$transaction(async (tx) => {
    for (const [key, value] of [
      [KEYS.publicKey, uretilen.publicKey],
      [KEYS.privateKey, sealed],
      [KEYS.subject, subject],
    ] as const) {
      await tx.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, description: "Web push VAPID" },
      });
    }

    // Denetim izine **anahtar yazılmaz**; yalnız işlemin yapıldığı.
    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "vapid",
      action: mevcut.configured
        ? AUDIT_ACTIONS.pushKeysReplaced
        : AUDIT_ACTIONS.pushKeysCreated,
      now,
    });
  });

  return { ok: true, publicKey: uretilen.publicKey, replaced: mevcut.configured };
}
