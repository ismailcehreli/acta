import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";
import { appSecret } from "@/server/auth/config";
import { openSecret, sealSecret } from "@/server/crypto/secret-box";

// VAPID key pair for Web push (§12.3, Task 5.3b).
//
// The key pair is generated **once** and must remain stable: if changed,
// all browser subscriptions become invalid and everyone must re-grant permission.
// Therefore generation is a distinct action, not done automatically at startup.
//
// The private key is stored **sealed** in the same manner as the SMTP password:
// if written in plaintext, anyone with a database backup could dispatch notifications.
// The public key is not secret; it is sent to browsers.

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
  /** `mailto:` address; push services contact this on delivery issues. */
  subject: string;
}

/** UI representation; does not carry private key. */
export interface VapidView {
  configured: boolean;
  publicKey: string;
  subject: string;
}

const DEFAULT_SUBJECT = "mailto:it@example.test";

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

/** Public key given to browser; `null` if not configured. */
export async function readVapidPublicKey(db: VapidDb): Promise<string | null> {
  const map = await readMap(db);
  const publicKey = map.get(KEYS.publicKey) ?? "";
  if (publicKey === "" || (map.get(KEYS.privateKey) ?? "") === "") return null;
  return publicKey;
}

/**
 * Full keys for dispatching. Returns `null` if not configured or private key
 * cannot be decrypted.
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
      "[push] Could not decrypt VAPID private key (APP_SECRET may have changed). " +
        "Notifications are not sent.",
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
  | { ok: false; error: "invalid_subject" | "keys_exist"; message: string };

/**
 * Updates only contact address; does not touch keys.
 */
export type SaveSubjectResult =
  | { ok: true }
  | { ok: false; error: "invalid_subject"; message: string };

export async function saveVapidSubject(
  db: VapidDb,
  subject: string,
  actorId: string,
  now: Date = new Date(),
): Promise<SaveSubjectResult> {
  const cleanSubject = subject.trim();
  if (!/^mailto:.+@.+\..+/.test(cleanSubject)) {
    return {
      ok: false,
      error: "invalid_subject",
      message: "Contact address must start with 'mailto:', e.g. mailto:it@company.com",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: KEYS.subject },
      update: { value: cleanSubject },
      create: { key: KEYS.subject, value: cleanSubject, description: "Web push VAPID" },
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
      error: "invalid_subject",
      message: "Contact address must start with 'mailto:', e.g. mailto:it@company.com",
    };
  }

  const existing = await readVapidView(db);
  if (existing.configured && !options.replace) {
    return {
      ok: false,
      error: "keys_exist",
      message:
        "Key pair already exists. Refreshing invalidates all current subscriptions; check the confirmation box.",
    };
  }

  const generated = webpush.generateVAPIDKeys();
  const sealed = sealSecret(generated.privateKey, secret, SEAL_PURPOSE);

  await db.$transaction(async (tx) => {
    for (const [key, value] of [
      [KEYS.publicKey, generated.publicKey],
      [KEYS.privateKey, sealed],
      [KEYS.subject, subject],
    ] as const) {
      await tx.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, description: "Web push VAPID" },
      });
    }

    // Keys are not written to audit trail; only the fact that action occurred.
    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "vapid",
      action: existing.configured
        ? AUDIT_ACTIONS.pushKeysReplaced
        : AUDIT_ACTIONS.pushKeysCreated,
      now,
    });
  });

  return { ok: true, publicKey: generated.publicKey, replaced: existing.configured };
}
