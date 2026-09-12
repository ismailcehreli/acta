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

// Avatar image validation and storage:
// 1. File type is verified from magic bytes, not filename extension.
// 2. SVG is rejected for avatars to prevent stored XSS attacks.

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

let storageDir: string;

beforeEach(async () => {
  await resetDatabase();
  storageDir = await mkdtemp(path.join(tmpdir(), "avatar-test-"));
  process.env.AVATAR_STORAGE_DIR = storageDir;
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
  delete process.env.AVATAR_STORAGE_DIR;
});

async function createUserHelper() {
  const unit = await createOrgUnit({ name: "Workshop", type: "Root" });
  return createUser(unit.id, { fullName: "Lead Craftsman" });
}

describe("file type validation", () => {
  it("accepts PNG and stores extension", async () => {
    const user = await createUserHelper();

    const result = await saveAvatar(testDb, user.id, PNG);

    expect(result.ok).toBe(true);
    const updated = await testDb.user.findUnique({ where: { id: user.id } });
    expect(updated?.avatarExtension).toBe("png");
  });

  it("accepts JPEG", async () => {
    const user = await createUserHelper();

    expect((await saveAvatar(testDb, user.id, JPEG)).ok).toBe(true);
  });

  it("rejects SVG", async () => {
    const user = await createUserHelper();

    const result = await saveAvatar(testDb, user.id, SVG);

    expect(result.ok).toBe(false);
    const updated = await testDb.user.findUnique({ where: { id: user.id } });
    expect(updated?.avatarExtension).toBeNull();
  });

  it("rejects non-image content", async () => {
    const user = await createUserHelper();

    const result = await saveAvatar(testDb, user.id, Buffer.from("MZ\x90\x00"));

    expect(result.ok).toBe(false);
  });

  it("rejects empty file", async () => {
    const user = await createUserHelper();

    expect((await saveAvatar(testDb, user.id, Buffer.alloc(0))).ok).toBe(false);
  });

  it("rejects file exceeding size limit", async () => {
    const user = await createUserHelper();
    const oversized = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);

    const result = await saveAvatar(testDb, user.id, oversized);

    expect(result.ok).toBe(false);
  });
});

describe("storage management", () => {
  it("reads back uploaded file", async () => {
    const user = await createUserHelper();
    await saveAvatar(testDb, user.id, PNG);

    const read = await readAvatar(user.id, "png");

    expect(read?.equals(PNG)).toBe(true);
  });

  it("replaces old file when new avatar is uploaded", async () => {
    const user = await createUserHelper();
    await saveAvatar(testDb, user.id, PNG);
    await saveAvatar(testDb, user.id, JPEG);

    const updated = await testDb.user.findUnique({ where: { id: user.id } });
    expect(updated?.avatarExtension).toBe("jpg");
    await expect(readFile(path.join(storageDir, `${user.id}.png`))).rejects.toThrow();
  });

  it("clears field and deletes file on removal", async () => {
    const user = await createUserHelper();
    await saveAvatar(testDb, user.id, PNG);

    await removeAvatar(testDb, user.id);

    const updated = await testDb.user.findUnique({ where: { id: user.id } });
    expect(updated?.avatarExtension).toBeNull();
    expect(await readAvatar(user.id, "png")).toBeNull();
  });

  it("prevents path traversal attempts in user ID", async () => {
    expect(await readAvatar("../../etc/passwd", "png")).toBeNull();
  });
});

describe("initials extraction", () => {
  it("extracts first letter of first and last name", () => {
    expect(initials("John Doe")).toBe("JD");
  });

  it("returns single letter for single-word name", () => {
    expect(initials("John")).toBe("J");
  });

  it("uses first and last word for three-word names", () => {
    expect(initials("John Michael Doe")).toBe("JD");
  });

  it("preserves Turkish characters when capitalizing", () => {
    expect(initials("ışık ırmak")).toBe("II");
    expect(initials("İnci Şahin")).toBe("İŞ");
  });

  it("handles empty name gracefully", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });
});

describe("avatar tone index", () => {
  it("produces deterministic tone for the same ID", () => {
    const a = avatarToneIndex("3f2a9c1e-0000-4000-8000-000000000001");
    const b = avatarToneIndex("3f2a9c1e-0000-4000-8000-000000000001");

    expect(a).toBe(b);
  });

  it("keeps tone index within defined bounds", () => {
    for (const id of ["a", "bb", "ccc", "3f2a9c1e-0000-4000-8000-000000000009"]) {
      const tone = avatarToneIndex(id);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(6);
    }
  });

  it("returns valid tone index for empty ID", () => {
    expect(avatarToneIndex("")).toBe(0);
  });
});
