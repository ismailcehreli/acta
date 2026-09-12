import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Draft attachment, activity attachment, and atomic transfer during submission (§5.7, §15.4).
const NOW = new Date("2026-09-04T09:00:00.000Z");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "draft-attachment-test-"));
  process.env.ATTACHMENT_STORAGE_DIR = storageDir;
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  await testDb.$disconnect();
});

const DRAFT = {
  activityDate: "2026-09-04",
  title: "Tooling maintenance",
  description: "Maintenance was performed on two parts.",
  targetDepartmentIds: [] as string[],
  openFollowUp: false,
  savedManually: true,
};

async function createDraft() {
  const unit = await createOrgUnit({ name: "Tooling Workshop" });
  const author = await createUser(unit.id, { email: "draft-author@example.test" });
  const other = await createUser(unit.id, { email: "draft-other@example.test" });
  const { saveDraft } = await import("@/server/activities/drafts");
  const draft = await saveDraft(testDb, author.id, DRAFT, NOW);
  if (!draft.ok) throw new Error("failed to create draft");
  return { unit, author, other, draft: draft.draft };
}

describe("lifecycle of draft attachments", () => {
  it("keeps both selections in draft and only visible to author", async () => {
    const { author, other, draft } = await createDraft();
    const { listDraftAttachments, saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );

    const result = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [
        { originalName: "first.png", content: PNG },
        { originalName: "second.png", content: PNG },
      ],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(
      (await listDraftAttachments(testDb, author.id, draft.id)).map(
        (file) => file.originalName,
      ),
    ).toEqual(["first.png", "second.png"]);
    expect(await listDraftAttachments(testDb, other.id, draft.id)).toEqual([]);
  });

  it("cannot delete draft attachment directly; deleted during explicit draft deletion", async () => {
    const { author, draft } = await createDraft();
    const { saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );
    const { deleteDraft } = await import("@/server/activities/drafts");

    const result = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [{ originalName: "keep.png", content: PNG }],
      NOW,
    );
    if (!result.ok) throw new Error("failed to setup attachment");

    await expect(
      testDb.activityDraftAttachment.deleteMany({ where: { draftId: draft.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
    expect(await testDb.activityDraftAttachment.count()).toBe(1);

    const storagePath = result.value[0].storagePath;
    expect(await deleteDraft(testDb, author.id, draft.id)).toBe(true);
    expect(await testDb.activityDraftAttachment.count()).toBe(0);
    await expect(readFile(path.join(storageDir, storagePath))).rejects.toThrow();
  });
});

describe("draft submission", () => {
  it("combines draft attachments and files selected at submission into single activity", async () => {
    const { author, draft } = await createDraft();
    const { saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );
    const { createActivity } = await import("@/server/activities/write");

    const draftAttachments = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [{ originalName: "draft.png", content: PNG }],
      NOW,
    );
    if (!draftAttachments.ok) throw new Error("failed to setup attachment");

    const result = await createActivity(
      testDb,
      {
        id: author.id,
        orgUnitId: author.orgUnitId,
        requiresApproval: false,
      },
      {
        activityDate: DRAFT.activityDate,
        title: DRAFT.title,
        description: DRAFT.description,
        targetDepartmentIds: [],
      },
      NOW,
      {
        draftId: draft.id,
        files: [{ originalName: "submission.png", content: PNG }],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const attachments = await testDb.attachment.findMany({
      where: { activityId: result.activity.id },
      orderBy: { originalName: "asc" },
    });
    expect(attachments.map((file) => file.originalName)).toEqual([
      "draft.png",
      "submission.png",
    ]);
    expect(await testDb.activityDraft.count()).toBe(0);
    expect(await testDb.activityDraftAttachment.count()).toBe(0);

    // Physical contents of moved file remain the same; ownership simply moves
    // from draft to activity.
    await expect(
      readFile(path.join(storageDir, attachments[0].storagePath)),
    ).resolves.toEqual(PNG);
  });

  it("preserves draft and attachments if submission fails", async () => {
    const { author, draft } = await createDraft();
    const { saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );
    const { createActivity } = await import("@/server/activities/write");
    const { SETTING_KEYS } = await import("@/server/settings/system-settings");

    const draftAttachments = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [{ originalName: "persistent.png", content: PNG }],
      NOW,
    );
    if (!draftAttachments.ok) throw new Error("failed to setup attachment");

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.attachmentMaxCount,
        value: "1",
        description: "Maximum attachment count",
      },
    });

    const result = await createActivity(
      testDb,
      {
        id: author.id,
        orgUnitId: author.orgUnitId,
        requiresApproval: false,
      },
      {
        activityDate: DRAFT.activityDate,
        title: DRAFT.title,
        description: DRAFT.description,
        targetDepartmentIds: [],
      },
      NOW,
      {
        draftId: draft.id,
        files: [{ originalName: "second.png", content: PNG }],
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("too_many");
    expect(await testDb.activity.count()).toBe(0);
    expect(await testDb.activityDraft.count()).toBe(1);
    expect(await testDb.activityDraftAttachment.count()).toBe(1);
    await expect(
      readFile(path.join(storageDir, draftAttachments.value[0].storagePath)),
    ).resolves.toEqual(PNG);
  });
});

describe("uploading attachment while pending approval", () => {
  it("author can upload attachment within three minutes during same approval round", async () => {
    const root = await createOrgUnit({ name: "Parent Unit", type: "Root" });
    const unit = await createOrgUnit({
      name: "Tooling Workshop",
      parentId: root.id,
      requiresApproval: true,
    });
    const manager = await createUser(root.id, {
      email: "approver@example.test",
      isUnitManager: true,
    });
    const author = await createUser(unit.id, { email: "activity-author@example.test" });
    const { createActivity, updateActivity } = await import(
      "@/server/activities/write"
    );

    const created = await createActivity(
      testDb,
      { id: author.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: DRAFT.activityDate,
        title: "Initial record",
        description: "Initial description",
        targetDepartmentIds: [],
      },
      NOW,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.activity.approverId).toBe(manager.id);

    const updated = await updateActivity(
      testDb,
      author.id,
      {
        id: created.activity.id,
        activityDate: DRAFT.activityDate,
        title: "Corrected record",
        description: "Photo added later.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 3 * 60_000),
      { files: [{ originalName: "subsequent.png", content: PNG }] },
    );

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.activity.approvalStatus).toBe("PENDING_APPROVAL");
    expect(updated.activity.currentRevisionNo).toBe(2);
    expect(
      await testDb.approvalRound.count({ where: { activityId: created.activity.id } }),
    ).toBe(1);
    expect(
      await testDb.attachment.count({ where: { activityId: created.activity.id } }),
    ).toBe(1);
  });
});
