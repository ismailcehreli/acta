import { ActivityApprovalStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Onay sürecindeki durumlar onaylayıcı ister (kısıt
 * `Activity_approver_required_in_approval`) ve düzeltme durumu gerekçe ister.
 * Bu yardımcı geçiş testleri için o alanları tamamlar; sınanan şey geçişin
 * kendisi, alanların varlığı değil.
 */
/** Gerekçe alanları; kısıt "düzeltme istendi" ve "reddedildi"de zorunlu kılar. */
async function gerekceAlanlari(status: ActivityApprovalStatus) {
  if (status !== "CHANGES_REQUESTED" && status !== "REJECTED") return {};

  const reason = await testDb.approvalReason.upsert({
    where: { kind_label: { kind: status, label: "Test gerekçesi" } },
    create: { kind: status, label: "Test gerekçesi" },
    update: {},
  });

  return { approvalReasonId: reason.id, approvalReasonKind: status } as const;
}

async function newActivity(status?: ActivityApprovalStatus) {
  const unit = await createOrgUnit();
  const user = await createUser(unit.id);
  const onaylayan = await createUser(unit.id, { fullName: "Onaylayan" });

  return createActivity(
    user,
    status
      ? {
          approvalStatus: status,
          approverId: onaylayan.id,
          ...(await gerekceAlanlari(status)),
        }
      : {},
  );
}

describe("muhatap departman sayısı kısıtı", () => {
  it("beş muhatap departman eklenebilir", async () => {
    const activity = await newActivity();
    const root = await testDb.orgUnit.findFirstOrThrow();

    for (let i = 0; i < 4; i += 1) {
      const dept = await createOrgUnit({ parentId: root.id });
      await testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: dept.id },
      });
    }
    await testDb.activityTargetDept.create({
      data: { activityId: activity.id, orgUnitId: root.id },
    });

    const count = await testDb.activityTargetDept.count({
      where: { activityId: activity.id },
    });
    expect(count).toBe(5);
  });

  it("altıncı muhatap departman eklenemez", async () => {
    const activity = await newActivity();
    const root = await testDb.orgUnit.findFirstOrThrow();

    for (let i = 0; i < 5; i += 1) {
      const dept = await createOrgUnit({ parentId: root.id });
      await testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: dept.id },
      });
    }

    const sixth = await createOrgUnit({ parentId: root.id });
    await expect(
      testDb.activityTargetDept.create({
        data: { activityId: activity.id, orgUnitId: sixth.id },
      }),
    ).rejects.toThrow(/ACTIVITY_TARGET_LIMIT/);
  });
});

// §5.4'teki durum diyagramı. Geçerli olmayan her geçiş, uygulama kodu ne
// yaparsa yapsın veritabanınca reddedilir.
describe("onay durumu geçişleri", () => {
  const allowed: [ActivityApprovalStatus, ActivityApprovalStatus][] = [
    ["DRAFT", "PENDING_APPROVAL"],
    ["PENDING_APPROVAL", "APPROVED"],
    ["PENDING_APPROVAL", "CHANGES_REQUESTED"],
    ["PENDING_APPROVAL", "MANAGER_NOT_FOUND"],
    ["CHANGES_REQUESTED", "PENDING_APPROVAL"],
    ["CHANGES_REQUESTED", "MANAGER_NOT_FOUND"],
    ["MANAGER_NOT_FOUND", "PENDING_APPROVAL"],
    ["APPROVED", "CANCELLED"],
  ];

  const rejected: [ActivityApprovalStatus, ActivityApprovalStatus][] = [
    // İptal geri alınamaz (§5.5).
    ["CANCELLED", "APPROVED"],
    ["CANCELLED", "DRAFT"],
    // Yöneticisi bulunamayan faaliyet kendiliğinden onaylanmış sayılamaz (§4.4).
    ["MANAGER_NOT_FOUND", "APPROVED"],
    // Onaylanmış faaliyet onay akışına geri dönmez.
    ["APPROVED", "PENDING_APPROVAL"],
    ["APPROVED", "CHANGES_REQUESTED"],
    // Onay adımı atlanamaz.
    ["PENDING_APPROVAL", "DRAFT"],
    ["CHANGES_REQUESTED", "APPROVED"],
  ];

  it.each(allowed)("%s → %s geçişine izin verilir", async (from, to) => {
    const activity = await newActivity(from);

    const updated = await testDb.activity.update({
      where: { id: activity.id },
      data: {
        approvalStatus: to,
        // Gerekçe yalnız "düzeltme istendi" ve "reddedildi" durumlarında
        // bulunabilir; geçişle birlikte hedef duruma uydurulur.
        ...(await gerekceAlanlari(to)),
        ...(to === "CHANGES_REQUESTED" || to === "REJECTED"
          ? {}
          : { approvalReasonId: null, approvalReasonKind: null }),
      },
    });

    expect(updated.approvalStatus).toBe(to);
  });

  it.each(rejected)("%s → %s geçişi reddedilir", async (from, to) => {
    const activity = await newActivity(from);

    await expect(
      testDb.activity.update({
        where: { id: activity.id },
        data: {
          approvalStatus: to,
          ...(await gerekceAlanlari(to)),
          ...(to === "CHANGES_REQUESTED" || to === "REJECTED"
            ? {}
            : { approvalReasonId: null, approvalReasonKind: null }),
        },
      }),
    ).rejects.toThrow(/ACTIVITY_INVALID_STATUS_TRANSITION/);
  });

  it("durum değişmeyen güncelleme engellenmez", async () => {
    const activity = await newActivity("APPROVED");

    const updated = await testDb.activity.update({
      where: { id: activity.id },
      data: { title: "Düzeltilmiş başlık" },
    });

    expect(updated.title).toBe("Düzeltilmiş başlık");
  });
});
