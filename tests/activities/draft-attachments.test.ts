import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Taslak eki, faaliyet eki ve gönderimdeki atomik taşıma (§5.7, §15.4).
const NOW = new Date("2026-09-04T09:00:00.000Z");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "taslak-ek-testi-"));
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
  title: "Kalıp bakımı",
  description: "İki parça üzerinde bakım yapıldı.",
  targetDepartmentIds: [] as string[],
  openFollowUp: false,
  savedManually: true,
};

async function createDraft() {
  const unit = await createOrgUnit({ name: "Kalıphane" });
  const author = await createUser(unit.id, { email: "taslak-yazar@ornek.test" });
  const other = await createUser(unit.id, { email: "taslak-baskasi@ornek.test" });
  const { saveDraft } = await import("@/server/activities/drafts");
  const draft = await saveDraft(testDb, author.id, DRAFT, NOW);
  if (!draft.ok) throw new Error("taslak kurulamadı");
  return { unit, author, other, draft: draft.draft };
}

describe("taslak eklerinin yaşam döngüsü", () => {
  it("iki ayrı seçim kaydı da taslakta tutulur ve yalnız yazarı görür", async () => {
    const { author, other, draft } = await createDraft();
    const { listDraftAttachments, saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );

    const sonuc = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [
        { originalName: "ilk.png", content: PNG },
        { originalName: "ikinci.png", content: PNG },
      ],
      NOW,
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;
    expect(sonuc.value).toHaveLength(2);
    expect(
      (await listDraftAttachments(testDb, author.id, draft.id)).map(
        (file) => file.originalName,
      ),
    ).toEqual(["ilk.png", "ikinci.png"]);
    expect(await listDraftAttachments(testDb, other.id, draft.id)).toEqual([]);
  });

  it("taslak eki doğrudan silinemez; açık taslak silme işleminde silinir", async () => {
    const { author, draft } = await createDraft();
    const { saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );
    const { deleteDraft } = await import("@/server/activities/drafts");

    const sonuc = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [{ originalName: "korunacak.png", content: PNG }],
      NOW,
    );
    if (!sonuc.ok) throw new Error("ek kurulamadı");

    await expect(
      testDb.activityDraftAttachment.deleteMany({ where: { draftId: draft.id } }),
    ).rejects.toThrow(/PHYSICAL_DELETE_FORBIDDEN/);
    expect(await testDb.activityDraftAttachment.count()).toBe(1);

    const storagePath = sonuc.value[0].storagePath;
    expect(await deleteDraft(testDb, author.id, draft.id)).toBe(true);
    expect(await testDb.activityDraftAttachment.count()).toBe(0);
    await expect(readFile(path.join(storageDir, storagePath))).rejects.toThrow();
  });
});

describe("taslak gönderimi", () => {
  it("taslak eklerini ve gönderimde seçilen eki tek faaliyette birleştirir", async () => {
    const { author, draft } = await createDraft();
    const { saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );
    const { createActivity } = await import("@/server/activities/write");

    const taslakEkleri = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [{ originalName: "taslak.png", content: PNG }],
      NOW,
    );
    if (!taslakEkleri.ok) throw new Error("ek kurulamadı");

    const sonuc = await createActivity(
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
        files: [{ originalName: "gonderimde.png", content: PNG }],
      },
    );

    expect(sonuc.ok).toBe(true);
    if (!sonuc.ok) return;

    const attachments = await testDb.attachment.findMany({
      where: { activityId: sonuc.activity.id },
      orderBy: { originalName: "asc" },
    });
    expect(attachments.map((file) => file.originalName)).toEqual([
      "gonderimde.png",
      "taslak.png",
    ]);
    expect(await testDb.activityDraft.count()).toBe(0);
    expect(await testDb.activityDraftAttachment.count()).toBe(0);

    // Taşınan dosyanın fiziksel içeriği de aynı kalır; yalnız satırın sahibi
    // taslaktan faaliyete geçmiştir.
    await expect(
      readFile(path.join(storageDir, attachments[1].storagePath)),
    ).resolves.toEqual(PNG);
  });

  it("gönderim başarısız olursa taslak ve ekleri korunur", async () => {
    const { author, draft } = await createDraft();
    const { saveDraftAttachments } = await import(
      "@/server/activities/draft-attachments"
    );
    const { createActivity } = await import("@/server/activities/write");
    const { SETTING_KEYS } = await import("@/server/settings/system-settings");

    const taslakEkleri = await saveDraftAttachments(
      testDb,
      author.id,
      draft.id,
      [{ originalName: "kaybolmayacak.png", content: PNG }],
      NOW,
    );
    if (!taslakEkleri.ok) throw new Error("ek kurulamadı");

    await testDb.systemSetting.create({
      data: {
        key: SETTING_KEYS.attachmentMaxCount,
        value: "1",
        description: "Azami ek sayısı",
      },
    });

    const sonuc = await createActivity(
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
        files: [{ originalName: "ikinci.png", content: PNG }],
      },
    );

    expect(sonuc.ok).toBe(false);
    if (sonuc.ok) return;
    expect(sonuc.error).toBe("too_many");
    expect(await testDb.activity.count()).toBe(0);
    expect(await testDb.activityDraft.count()).toBe(1);
    expect(await testDb.activityDraftAttachment.count()).toBe(1);
    await expect(
      readFile(path.join(storageDir, taslakEkleri.value[0].storagePath)),
    ).resolves.toEqual(PNG);
  });
});

describe("onay beklerken ek yükleme", () => {
  it("yazar üç dakika sonra aynı onay turunda ek yükleyebilir", async () => {
    const root = await createOrgUnit({ name: "Üst Birim", type: "Kök" });
    const unit = await createOrgUnit({
      name: "Kalıphane",
      parentId: root.id,
      requiresApproval: true,
    });
    const manager = await createUser(root.id, {
      email: "onayci@ornek.test",
      isUnitManager: true,
    });
    const author = await createUser(unit.id, { email: "faaliyet-yazar@ornek.test" });
    const { createActivity, updateActivity } = await import(
      "@/server/activities/write"
    );

    const created = await createActivity(
      testDb,
      { id: author.id, orgUnitId: unit.id, requiresApproval: true },
      {
        activityDate: DRAFT.activityDate,
        title: "İlk kayıt",
        description: "İlk açıklama",
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
        title: "Düzeltilmiş kayıt",
        description: "Fotoğraf sonradan eklendi.",
        targetDepartmentIds: [],
      },
      new Date(NOW.getTime() + 3 * 60_000),
      { files: [{ originalName: "sonradan.png", content: PNG }] },
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
