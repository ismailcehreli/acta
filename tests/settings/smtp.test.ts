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

// SMTP settings managed via UI (§12.3, §16.5). Password stored encrypted.

const SECRET = "test-secret-at-least-thirty-two-chars-long";
const SETTINGS = {
  host: "mail.example.test",
  port: 587,
  secure: false,
  user: "activity",
  from: "Activity <activity@example.test>",
};

beforeEach(async () => {
  await resetDatabase();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_FROM;
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("secret box", () => {
  it("encrypted value decrypts back to original", () => {
    const sealed = sealSecret("secret-password", SECRET, "smtp-password");

    expect(sealed).not.toContain("secret-password");
    expect(openSecret(sealed, SECRET, "smtp-password")).toBe("secret-password");
  });

  it("each encryption yields distinct output", () => {
    const first = sealSecret("same-value", SECRET, "smtp-password");
    const second = sealSecret("same-value", SECRET, "smtp-password");

    // Random IV: two encryptions of same value never match.
    expect(first).not.toBe(second);
  });

  it("cannot be decrypted with different key or different purpose", () => {
    const sealed = sealSecret("secret", SECRET, "smtp-password");

    expect(openSecret(sealed, "other-key-at-least-thirty-two-characters-long", "smtp-password")).toBeNull();
    expect(openSecret(sealed, SECRET, "other-purpose")).toBeNull();
  });

  it("tampered value does not decrypt", () => {
    const sealed = sealSecret("secret", SECRET, "smtp-password");
    const parts = sealed.split(".");
    const corrupt = `${parts[0]}.${parts[1]}.${Buffer.from("fake").toString("base64url")}`;

    expect(openSecret(corrupt, SECRET, "smtp-password")).toBeNull();
    expect(openSecret("corrupt-format", SECRET, "smtp-password")).toBeNull();
  });
});

describe("settings persistence", () => {
  it("password is not stored in plaintext in database", async () => {
    await saveSmtpSettings(testDb, { ...SETTINGS, password: "very-secret-password" }, SECRET);

    const records = await testDb.systemSetting.findMany();
    const concatenated = records.map((k) => k.value).join(" ");

    expect(concatenated).not.toContain("very-secret-password");
    // But decryptable for mail sending.
    const settings = await readSmtpSettings(testDb, SECRET);
    expect(settings?.password).toBe("very-secret-password");
  });

  it("password is not exposed to client view", async () => {
    await saveSmtpSettings(testDb, { ...SETTINGS, password: "secret" }, SECRET);

    const view = await readSmtpView(testDb);

    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(view.host).toBe(SETTINGS.host);
    expect(view.source).toBe("database");
  });

  it("empty password preserves existing password", async () => {
    await saveSmtpSettings(testDb, { ...SETTINGS, password: "initial-password" }, SECRET);
    await saveSmtpSettings(testDb, { ...SETTINGS, port: 465, secure: true }, SECRET);

    const settings = await readSmtpSettings(testDb, SECRET);
    expect(settings?.password).toBe("initial-password");
    expect(settings?.port).toBe(465);
    expect(settings?.secure).toBe(true);
  });

  it("password can be cleared", async () => {
    const unit = await createOrgUnit({ name: "Company", type: "Root" });
    const actor = await createUser(unit.id, {
      email: "admin@example.test",
      isSystemAdmin: true,
    });

    await saveSmtpSettings(testDb, { ...SETTINGS, password: "to-delete" }, SECRET);
    await clearSmtpPassword(testDb, actor.id);

    const view = await readSmtpView(testDb);
    expect(view.hasPassword).toBe(false);
    const settings = await readSmtpSettings(testDb, SECRET);
    expect(settings?.password).toBe("");

    // Audit logged (§15.2): clearing password can stop notification channel.
    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "smtp_password_cleared" },
    });
    expect(log.userId).toBe(actor.id);
  });

  it("undecryptable password is not silently treated as empty", async () => {
    await saveSmtpSettings(testDb, { ...SETTINGS, password: "secret" }, SECRET);

    const settings = await readSmtpSettings(
      testDb,
      "completely-different-key-at-least-thirty-two",
    );

    // Treat as missing rather than attempting connection with empty password.
    expect(settings).toBeNull();
  });
});

describe("source precedence", () => {
  it("environment variables used when no database records exist", async () => {
    process.env.SMTP_HOST = "env.example.test";
    process.env.SMTP_FROM = "env@example.test";

    const view = await readSmtpView(testDb);
    expect(view.source).toBe("environment");
    expect(view.host).toBe("env.example.test");

    const settings = await readSmtpSettings(testDb, SECRET);
    expect(settings?.host).toBe("env.example.test");
  });

  it("database record overrides environment variables", async () => {
    process.env.SMTP_HOST = "env.example.test";
    process.env.SMTP_FROM = "env@example.test";
    await saveSmtpSettings(testDb, SETTINGS, SECRET);

    const settings = await readSmtpSettings(testDb, SECRET);
    expect(settings?.host).toBe(SETTINGS.host);
  });

  it("if neither exists, delivery settings are null", async () => {
    expect(await readSmtpSettings(testDb, SECRET)).toBeNull();
    expect((await readSmtpView(testDb)).source).toBe("none");
  });

  it("settings invalid if from address missing", async () => {
    await saveSmtpSettings(testDb, { ...SETTINGS, from: "" }, SECRET);

    expect(await readSmtpSettings(testDb, SECRET)).toBeNull();
  });
});
