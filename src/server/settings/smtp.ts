import type { PrismaClient } from "@prisma/client";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { appSecret } from "@/server/auth/config";
import { openSecret, sealSecret } from "@/server/crypto/secret-box";



//


//




const SEAL_PURPOSE = "smtp-password";

const KEYS = {
  host: "smtp_host",
  port: "smtp_port",
  secure: "smtp_secure",
  user: "smtp_user",
  password: "smtp_password_sealed",
  from: "smtp_from",
} as const;

export type SmtpDb = Pick<
  PrismaClient,
  "systemSetting" | "auditLog" | "$transaction"
>;

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface SmtpView {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;

  hasPassword: boolean;

  source: "database" | "environment" | "none";
}

async function readMap(db: SmtpDb): Promise<Map<string, string>> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  return new Map(rows.map((row) => [row.key, row.value]));
}


export async function readSmtpView(db: SmtpDb): Promise<SmtpView> {
  const map = await readMap(db);
  const host = map.get(KEYS.host) ?? "";

  if (host !== "") {
    return {
      host,
      port: Number(map.get(KEYS.port) ?? 587),
      secure: map.get(KEYS.secure) === "true",
      user: map.get(KEYS.user) ?? "",
      from: map.get(KEYS.from) ?? "",
      hasPassword: (map.get(KEYS.password) ?? "") !== "",
      source: "database",
    };
  }

  const envHost = process.env.SMTP_HOST ?? "";
  if (envHost !== "") {
    return {
      host: envHost,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER ?? "",
      from: process.env.SMTP_FROM ?? "",
      hasPassword: (process.env.SMTP_PASSWORD ?? "") !== "",
      source: "environment",
    };
  }

  return {
    host: "",
    port: 587,
    secure: false,
    user: "",
    from: "",
    hasPassword: false,
    source: "none",
  };
}


export async function readSmtpSettings(
  db: SmtpDb,
  secret: string = appSecret(),
): Promise<SmtpSettings | null> {
  const map = await readMap(db);
  const host = map.get(KEYS.host) ?? "";

  if (host !== "") {
    const sealed = map.get(KEYS.password) ?? "";
    const password = sealed === "" ? "" : (openSecret(sealed, secret, SEAL_PURPOSE) ?? "");



    if (sealed !== "" && password === "") {
      console.error(
        "[smtp] Stored password could not be decrypted (APP_SECRET may have changed); " +
          "SMTP settings are ignored.",
      );
      return null;
    }

    const from = map.get(KEYS.from) ?? "";
    if (from === "") return null;

    return {
      host,
      port: Number(map.get(KEYS.port) ?? 587),
      secure: map.get(KEYS.secure) === "true",
      user: map.get(KEYS.user) ?? "",
      password,
      from,
    };
  }

  const envHost = process.env.SMTP_HOST;
  const envFrom = process.env.SMTP_FROM;
  if (!envHost || !envFrom) return null;

  return {
    host: envHost,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: envFrom,
  };
}

export interface SmtpInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;

  password?: string;
}

export async function saveSmtpSettings(
  db: SmtpDb,
  input: SmtpInput,
  secret: string = appSecret(),
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  const records: { key: string; value: string; description: string }[] = [
    { key: KEYS.host, value: input.host.trim(), description: "SMTP server address" },
    { key: KEYS.port, value: String(input.port), description: "SMTP port" },
    { key: KEYS.secure, value: String(input.secure), description: "SMTP TLS" },
    { key: KEYS.user, value: input.user.trim(), description: "SMTP username" },
    { key: KEYS.from, value: input.from.trim(), description: "Sender address" },
  ];

  if (input.password !== undefined && input.password !== "") {
    records.push({
      key: KEYS.password,
      value: sealSecret(input.password, secret, SEAL_PURPOSE),
      description: "SMTP password (encrypted)",
    });
  }

  await db.$transaction(async (tx) => {
    for (const item of records) {
      await tx.systemSetting.upsert({
        where: { key: item.key },
        update: { value: item.value, description: item.description },
        create: { key: item.key, value: item.value, description: item.description },
      });
    }

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "smtp",
      action: AUDIT_ACTIONS.smtpChanged,


      detail: {
        host: input.host,
        port: input.port,
        secure: input.secure,
        user: input.user,
        from: input.from,
        passwordChanged: input.password !== undefined && input.password !== "",
      },
      now,
    });
  });
}


export async function clearSmtpPassword(
  db: SmtpDb,
  actorId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.systemSetting.deleteMany({ where: { key: KEYS.password } });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "smtp",
      action: AUDIT_ACTIONS.smtpPasswordCleared,
      now,
    });
  });
}
