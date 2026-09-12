import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §15.4: file attachment security. Type is validated from content not extension,
// storage name is server-generated, downloads pass through visibility authorization.

const NOW = new Date("2026-08-17T09:00:00.000Z");

let storageDir: string;

beforeAll(async () => {
  // Storage is initialized in a temporary directory: tests never write to real storage.
  storageDir = await mkdtemp(path.join(tmpdir(), "attachment-test-"));
  process.env.ATTACHMENT_STORAGE_DIR = storageDir;
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  await testDb.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Real files: type sniffing from content can only be tested this way. */
// 1x1 pixel PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 2)]);
/** Windows executable header signature. */
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(128, 3)]);
/**
 * Minimal but valid MP4 header (`ftyp` box, isom brand).
 * Since mime detection checks content signatures, mock bytes are insufficient.
 */
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2"),
  Buffer.alloc(32, 0),
]);

async function scenario() {
  const root = await createOrgUnit({ name: "Headquarters", type: "Root" });
  const moldShop = await createOrgUnit({ name: "Tooling Workshop", parentId: root.id });
  const planning = await createOrgUnit({ name: "Planning", parentId: root.id });

  const manager = await createUser(moldShop.id, {
    fullName: "Tooling Manager",
    isUnitManager: true,
  });
  const author = await createUser(moldShop.id, { fullName: "Worker" });
  const peer = await createUser(planning.id, {
    fullName: "Planning Manager",
    isUnitManager: true,
  });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: moldShop.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Tooling maintenance",
      description: "Description",
      approvalStatus: "APPROVED",
    },
  });

  return { manager, author, peer, activity };
}

const viewer = (user: { id: string }) => ({ id: user.id, isSystemAdmin: false });

describe("type validation performs content sniffing (§15.4)", () => {
  it("rejects executable disguised with pdf extension", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "report.pdf", content: EXE }],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupported_type");
    expect(await testDb.attachment.count()).toBe(0);
  });

  it("accepts genuine PDF and determines mime type from content", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "report.txt", content: PDF }],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Determined from content despite .txt extension.
    expect(result.value[0].mimeType).toBe("application/pdf");
  });

  it("accepts video (product owner decision, 2026-09-03)", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "line-record.mp4", content: MP4 }],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].mimeType).toBe("video/mp4");
  });

  it("rejects empty file", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "empty.pdf", content: Buffer.alloc(0) }],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_file");
  });
});

describe("storage naming and integrity", () => {
  it("user-supplied filename is never written to disk", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "../../etc/passwd.png", content: PNG }],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const attachment = result.value[0];
    // Original name only stored in database; storedName has no path separators,
    // making path traversal injection impossible.
    expect(attachment.originalName).toBe("../../etc/passwd.png");
    expect(attachment.storedName).toMatch(/^[a-f0-9]+$/);
    expect(attachment.storedName).not.toContain("/");
    expect(attachment.storagePath).not.toContain("..");
  });

  it("stores SHA-256 digest", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { sha256Of } = await import("@/server/attachments/storage");
    const { author, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "image.png", content: PNG }],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].sha256).toBe(sha256Of(PNG));
  });

  // Audit 2026-08-21, finding 9: digest was stored on upload but verified on download.
  it("does not download file if storage copy has been tampered with", async () => {
    const { attachFiles, loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { author, activity } = await scenario();

    const uploaded = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "image.png", content: PNG }],
      NOW,
    );
    if (!uploaded.ok) throw new Error("setup");
    const attachment = uploaded.value[0];

    // Verification: can be downloaded before modification.
    const before = await loadAttachmentForDownload(
      testDb,
      { id: author.id, isSystemAdmin: false },
      attachment.id,
    );
    expect(before.ok).toBe(true);

    // Tamper file content in storage.
    const { writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const rootDir =
      process.env.ATTACHMENT_STORAGE_DIR ??
      path.join(process.cwd(), "storage", "attachments");
    await writeFile(path.resolve(rootDir, attachment.storagePath), Buffer.from("tampered content"));

    const after = await loadAttachmentForDownload(
      testDb,
      { id: author.id, isSystemAdmin: false },
      attachment.id,
    );

    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error).toBe("integrity_failed");
  });
});

describe("limits (§5.2)", () => {
  it("accepts five files, rejects sixth", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { author, activity } = await scenario();

    const five = Array.from({ length: 5 }, (_, index) => ({
      originalName: `file-${index}.png`,
      content: PNG,
    }));

    expect((await attachFiles(testDb, author.id, activity.id, five, NOW)).ok).toBe(
      true,
    );

    const sixth = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "sixth.png", content: PNG }],
      NOW,
    );

    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.error).toBe("too_many");
    expect(await testDb.attachment.count()).toBe(5);
  });

  it("reads file size limit from system settings", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { SETTING_KEYS } = await import("@/server/settings/system-settings");
    const { author, activity } = await scenario();

    // Limit set to 1 MB.
    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.attachmentMaxMb,
        value: "1",
        description: "Attachment max size (MB)",
      },
    });

    const largeFile = Buffer.concat([
      PNG,
      Buffer.alloc(2 * 1024 * 1024, 0),
    ]);

    const result = await attachFiles(
      testDb,
      author.id,
      activity.id,
      [{ originalName: "image.png", content: largeFile }],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("too_large");
  });

  it("cannot upload attachment to another user's activity", async () => {
    const { attachFiles } = await import("@/server/attachments/service");
    const { manager, activity } = await scenario();

    const result = await attachFiles(
      testDb,
      manager.id,
      activity.id,
      [{ originalName: "image.png", content: PNG }],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Activity not found.");
  });
});

describe("downloads pass through visibility authorization (§15.4)", () => {
  async function activityWithAttachment() {
    const { attachFiles } = await import("@/server/attachments/service");
    const context = await scenario();
    const result = await attachFiles(
      testDb,
      context.author.id,
      context.activity.id,
      [{ originalName: "image.png", content: PNG }],
      NOW,
    );
    if (!result.ok) throw new Error("setup");
    return { ...context, attachment: result.value[0] };
  }

  it("author can download own attachment", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { author, attachment } = await activityWithAttachment();

    const result = await loadAttachmentForDownload(
      testDb,
      viewer(author),
      attachment.id,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content.equals(PNG)).toBe(true);
  });

  it("manager authorized to view activity can also download attachment", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { manager, attachment } = await activityWithAttachment();

    expect(
      (await loadAttachmentForDownload(testDb, viewer(manager), attachment.id)).ok,
    ).toBe(true);
  });

  it("user unauthorized to view activity cannot download attachment", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { peer, attachment } = await activityWithAttachment();

    const result = await loadAttachmentForDownload(
      testDb,
      viewer(peer),
      attachment.id,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Existence of file is not revealed.
    expect(result.message).toBe("Attachment not found.");
  });

  it("attachment of cancelled activity is preserved, follows activity visibility", async () => {
    const { loadAttachmentForDownload } = await import(
      "@/server/attachments/service"
    );
    const { author, manager, peer, activity, attachment } = await activityWithAttachment();

    const { cancelActivity } = await import("@/server/activities/cancel");
    await cancelActivity(
      testDb,
      { id: author.id, isSystemAdmin: false },
      activity.id,
      "Entered incorrectly.",
      NOW,
    );

    // File remains and users with visibility can still download it.
    expect(await testDb.attachment.count()).toBe(1);
    expect(
      (await loadAttachmentForDownload(testDb, viewer(manager), attachment.id)).ok,
    ).toBe(true);
    // Unauthorized users still cannot.
    expect(
      (await loadAttachmentForDownload(testDb, viewer(peer), attachment.id)).ok,
    ).toBe(false);
  });
});
