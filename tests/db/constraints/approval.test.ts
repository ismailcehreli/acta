import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createApprovalReason,
  createOrgUnit,
  createUser,
} from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Onay akışının değişmezleri veritabanında da durur (AGENTS.md).
//
// Kısıtın değeri, uygulama katmanı devre dışıyken de geçerli olmasıdır: bu
// testler Prisma servislerini değil, doğrudan tabloyu zorlar.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function kisiler() {
  const birim = await createOrgUnit({ name: "Kalıphane" });
  const yazan = await createUser(birim.id, { fullName: "Kalıpçı" });
  const onaylayan = await createUser(birim.id, {
    fullName: "Müdür",
    isUnitManager: true,
  });
  return { birim, yazan, onaylayan };
}

function temel(yazan: { id: string; orgUnitId: string }) {
  return {
    authorId: yazan.id,
    authorOrgUnitId: yazan.orgUnitId,
    activityDate: new Date("2026-08-18T00:00:00.000Z"),
    title: "Kayıt",
    description: "içerik",
  };
}

describe("onay kısıtları", () => {
  it("onaylayıcısız 'onay bekliyor' kaydı reddedilir", async () => {
    const { yazan } = await kisiler();

    // Onaylayıcısı boş kalan kayıt kimsenin önüne düşmez ve sessizce kaybolur.
    await expect(
      testDb.activity.create({
        data: { ...temel(yazan), approvalStatus: "PENDING_APPROVAL" },
      }),
    ).rejects.toThrow(/Activity_approver_required_in_approval/);
  });

  it("kişi kendi faaliyetinin onaylayıcısı olamaz (§4.4)", async () => {
    const { yazan } = await kisiler();

    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "PENDING_APPROVAL",
          approverId: yazan.id,
        },
      }),
    ).rejects.toThrow(/Activity_approver_is_not_author/);
  });

  it("gerekçesiz 'düzeltme istendi' reddedilir", async () => {
    const { yazan, onaylayan } = await kisiler();

    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "CHANGES_REQUESTED",
          approverId: onaylayan.id,
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_matches_status/);
  });

  it("gerekçesiz reddetme kabul edilmez", async () => {
    const { yazan, onaylayan } = await kisiler();

    // Gerekçesiz bir ret, yazana ne olduğunu söylemeyen bir karardır.
    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "REJECTED",
          approverId: onaylayan.id,
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_matches_status/);
  });

  it("başka durumda gerekçe taşınamaz", async () => {
    const { yazan, onaylayan } = await kisiler();
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");

    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "APPROVED",
          approverId: onaylayan.id,
          approvalReasonId: gerekce.id,
          // Tür bilerek boş: bu test **gerekçenin o durumda duramayacağını**
          // sınıyor. Tür de doldurulsaydı önce tür kısıtı patlar ve asıl
          // sınanan kural hiç denenmemiş olurdu.
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_matches_status/);
  });

  it("kararın türüyle uyuşmayan gerekçe kabul edilmez", async () => {
    const { yazan, onaylayan } = await kisiler();
    const retGerekcesi = await createApprovalReason("REJECTED");

    // "Düzeltme istendi" kararına ret gerekçesi iliştirilemez. Uygulama
    // katmanı devre dışıyken de geçerli olmalı.
    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "CHANGES_REQUESTED",
          approverId: onaylayan.id,
          approvalReasonId: retGerekcesi.id,
          approvalReasonKind: "REJECTED",
        },
      }),
    ).rejects.toThrow(/Activity_approval_reason_kind_matches_status/);
  });

  it("kategorisiz açıklama duramaz", async () => {
    const { yazan, onaylayan } = await kisiler();

    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "APPROVED",
          approverId: onaylayan.id,
          approvalReasonNote: "Kategorisiz açıklama",
        },
      }),
    ).rejects.toThrow(/Activity_approval_note_requires_reason/);
  });

  it("olmayan gerekçe seçilemez", async () => {
    const { yazan, onaylayan } = await kisiler();

    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "REJECTED",
          approverId: onaylayan.id,
          approvalReasonId: "11111111-1111-4111-8111-111111111111",
          approvalReasonKind: "REJECTED",
        },
      }),
    ).rejects.toThrow(/foreign key|Activity_approvalReasonId/i);
  });

  it("kurallara uyan kayıt kabul edilir", async () => {
    const { yazan, onaylayan } = await kisiler();
    const gerekce = await createApprovalReason("CHANGES_REQUESTED");

    const kayit = await testDb.activity.create({
      data: {
        ...temel(yazan),
        approvalStatus: "CHANGES_REQUESTED",
        approverId: onaylayan.id,
        approvalReasonId: gerekce.id,
        approvalReasonKind: "CHANGES_REQUESTED",
        approvalReasonNote: "Ayrıntı ekle.",
      },
    });

    expect(kayit.approvalStatus).toBe("CHANGES_REQUESTED");
  });

  it("reddedilen kaydın onaylayıcısı olmak zorunda", async () => {
    const { yazan } = await kisiler();
    const gerekce = await createApprovalReason("REJECTED");

    await expect(
      testDb.activity.create({
        data: {
          ...temel(yazan),
          approvalStatus: "REJECTED",
          approverId: null,
          approvalReasonId: gerekce.id,
          approvalReasonKind: "REJECTED",
        },
      }),
    ).rejects.toThrow(/Activity_approver_required_in_approval/);
  });
});
