import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";
import { visibleReportScope } from "@/server/authz/visibility";
import {
  readReport,
  readReportForScope,
  reportPeriodRange,
  type ReportDb,
} from "@/server/reports/read";

const NOW = new Date("2026-08-29T09:00:00.000Z");
const AGUSTOS = new Date("2026-08-01T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sahne() {
  const root = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const operations = await createOrgUnit({
    name: "Operasyon Direktörlüğü",
    type: "Direktörlük",
    parentId: root.id,
  });
  const planning = await createOrgUnit({
    name: "Planlama Direktörlüğü",
    type: "Direktörlük",
    parentId: root.id,
  });
  const outside = await createOrgUnit({
    name: "Finans Direktörlüğü",
    type: "Direktörlük",
    parentId: root.id,
  });

  const viewer = await createUser(root.id, {
    fullName: "Yönetim Kurulu",
    isSystemAdmin: true,
    canViewReports: true,
    canViewScoreReports: true,
  });
  const branchViewer = await createUser(operations.id, {
    fullName: "Operasyon Direktörü",
    isUnitManager: true,
    canViewReports: true,
    canViewScoreReports: false,
  });
  const workerA = await createUser(operations.id, {
    fullName: "Operasyon Uzmanı",
  });
  const workerB = await createUser(planning.id, {
    fullName: "Planlama Uzmanı",
  });
  const outsideWorker = await createUser(outside.id, {
    fullName: "Finans Uzmanı",
  });

  const activityA = await createActivity(workerA, {
    title: "Operasyon kaydı",
    activityDate: new Date("2026-08-20T00:00:00.000Z"),
    approvalStatus: "APPROVED",
  });
  await createActivity(workerB, {
    title: "Planlama kaydı",
    activityDate: new Date("2026-08-21T00:00:00.000Z"),
    approvalStatus: "APPROVED",
  });
  await createActivity(outsideWorker, {
    title: "Finans kaydı",
    activityDate: new Date("2026-08-22T00:00:00.000Z"),
    approvalStatus: "APPROVED",
  });
  await createActivity(workerA, {
    title: "Bekleyen operasyon kaydı",
    activityDate: new Date("2026-08-23T00:00:00.000Z"),
    approvalStatus: "PENDING_APPROVAL",
    approverId: branchViewer.id,
    approvalSubmittedAt: new Date("2026-08-23T08:00:00.000Z"),
  });

  await testDb.noActivityPeriod.create({
    data: {
      userId: workerA.id,
      markedById: workerA.id,
      startDate: new Date("2026-08-24T00:00:00.000Z"),
      endDate: new Date("2026-08-26T00:00:00.000Z"),
      status: "APPROVED",
    },
  });
  await testDb.noActivityPeriod.create({
    data: {
      userId: workerB.id,
      markedById: workerB.id,
      startDate: new Date("2026-08-25T00:00:00.000Z"),
      endDate: new Date("2026-08-26T00:00:00.000Z"),
      status: "PENDING",
    },
  });
  await testDb.noActivityPeriod.create({
    data: {
      userId: outsideWorker.id,
      markedById: outsideWorker.id,
      startDate: new Date("2026-08-25T00:00:00.000Z"),
      endDate: new Date("2026-08-26T00:00:00.000Z"),
      status: "APPROVED",
    },
  });

  await testDb.notificationQueue.createMany({
    data: [
      {
        userId: workerA.id,
        eventType: "activity_approved",
        channel: "EMAIL",
        status: "SENT",
        payload: { privateText: "faaliyet metni rapora girmemeli" },
        idempotencyKey: "report-test-a-sent",
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
      },
      {
        userId: workerA.id,
        eventType: "approval_pending",
        channel: "PUSH",
        status: "FAILED",
        payload: { privateText: "özel bildirim içeriği" },
        idempotencyKey: "report-test-a-failed",
        createdAt: new Date("2026-08-21T10:00:00.000Z"),
      },
      {
        userId: workerB.id,
        eventType: "absence_request_submitted",
        channel: "EMAIL",
        status: "PENDING",
        payload: { privateText: "başka bir özel içerik" },
        idempotencyKey: "report-test-b-pending",
        createdAt: new Date("2026-08-22T10:00:00.000Z"),
      },
      {
        userId: outsideWorker.id,
        eventType: "activity_approved",
        channel: "EMAIL",
        status: "SENT",
        payload: { privateText: "kapsam dışı" },
        idempotencyKey: "report-test-outside",
        createdAt: new Date("2026-08-22T10:00:00.000Z"),
      },
    ],
  });

  await testDb.userScorePeriod.create({
    data: {
      userId: workerA.id,
      periodStart: AGUSTOS,
      regularity: 50,
      acceptance: 25,
      approval: null,
      followUp: 8,
      total: 85,
      expectedDays: 20,
      writtenDays: 17,
      appreciationPointsPer: 2,
      frozen: false,
    },
  });
  await testDb.userScorePeriodFact.create({
    data: {
      userId: workerA.id,
      periodStart: AGUSTOS,
      activityId: activityA.id,
      kind: "APPRECIATION",
      happenedOn: new Date("2026-08-20T00:00:00.000Z"),
    },
  });
  await testDb.userScorePeriod.update({
    where: {
      userId_periodStart_revisionNo: {
        userId: workerA.id,
        periodStart: AGUSTOS,
        revisionNo: 1,
      },
    },
    data: {
      frozen: true,
      profile: "employee",
      weightRegularity: 60,
      weightAcceptance: 30,
      weightApproval: 0,
      weightFollowUp: 10,
      formulaVersion: 2,
    },
  });

  await testDb.feedback.createMany({
    data: [
      {
        submittedById: workerA.id,
        category: "BUG",
        title: "Arama sorunu",
        description: "Detay rapora girmemeli.",
        status: "RESOLVED",
        createdAt: new Date("2026-08-20T08:00:00.000Z"),
        readAt: new Date("2026-08-20T10:00:00.000Z"),
        reviewedAt: new Date("2026-08-20T12:00:00.000Z"),
        resolvedAt: new Date("2026-08-21T08:00:00.000Z"),
      },
      {
        submittedById: workerB.id,
        category: "SUGGESTION",
        title: "Yeni süzgeç",
        description: "Başka bir detay rapora girmemeli.",
        status: "NEW",
        createdAt: new Date("2026-08-22T08:00:00.000Z"),
      },
    ],
  });

  // Raporlar geçmişi korur: hesabı pasifleştirilen kişinin daha önceki
  // kayıtları dönem özetinden düşmemeli. Pasif hesap yeni işlem başlatamaz;
  // burada yalnızca tarihsel kaydın rapora girmesi sınanıyor.
  await testDb.user.update({
    where: { id: workerA.id },
    data: { isActive: false },
  });

  return { root, operations, planning, viewer, branchViewer, workerA };
}

describe("rapor okuma", () => {
  it("dönem başlangıçlarını şirket gününe göre hesaplar", () => {
    expect(reportPeriodRange("month", NOW)).toMatchObject({
      startDay: "2026-08-01",
      endDay: "2026-08-29",
    });
    expect(reportPeriodRange("quarter", NOW).startDay).toBe("2026-07-01");
    expect(reportPeriodRange("year", NOW).startDay).toBe("2026-01-01");
    expect(reportPeriodRange("all", NOW).startDay).toBeNull();
  });

  it("üst yönetici kendi ağacının toplamını ve alt birimleri görür", async () => {
    const { viewer, operations, planning } = await sahne();

    const report = await readReport(
      testDb,
      { id: viewer.id },
      "activities",
      "month",
      undefined,
      NOW,
    );

    expect(report?.scope.unitIds).toEqual(
      expect.arrayContaining([operations.id, planning.id]),
    );
    if (!report || report.data.tab !== "activities") throw new Error("Rapor okunamadı");

    expect(report.data).toMatchObject({
      total: 4,
      approved: 3,
      pending: 1,
      people: 3,
    });
    expect(report.data.units.map((unit) => unit.name)).toEqual([
      "Şirket",
      "Finans Direktörlüğü",
      "Operasyon Direktörlüğü",
      "Planlama Direktörlüğü",
    ]);
    expect(report.data.units[0]).toMatchObject({
      activities: 4,
      people: 3,
    });
  });

  it("ara yönetici yalnızca kendi dalını görür", async () => {
    const { branchViewer, operations, planning } = await sahne();

    const report = await readReport(
      testDb,
      { id: branchViewer.id },
      "activities",
      "month",
      undefined,
      NOW,
    );

    expect(report?.selectedScope.rootOrgUnitId).toBe(operations.id);
    if (!report || report.data.tab !== "activities") throw new Error("Rapor okunamadı");
    expect(report.data.total).toBe(2);
    expect(report.data.units.map((unit) => unit.name)).not.toContain(
      "Planlama Direktörlüğü",
    );
    expect(
      await readReport(
        testDb,
        { id: branchViewer.id },
        "activities",
        "month",
        planning.id,
        NOW,
      ),
    ).toBeNull();
  });

  it("rapor yetkisi olmayan kullanıcıda hiçbir toplu veri dönmez", async () => {
    const { workerA } = await sahne();

    expect(
      await readReport(
        testDb,
        { id: workerA.id },
        "activities",
        "month",
        undefined,
        NOW,
      ),
    ).toBeNull();
  });

  it("önceden hesaplanan kapsamı yeniden sorgulamaz", async () => {
    const { viewer } = await sahne();
    const scope = await visibleReportScope(testDb, viewer.id);
    if (!scope) throw new Error("Rapor kapsamı okunamadı");

    // Çekirdek yolun kapsamı yeniden hesaplamadığını, kullanıcı delegesi
    // olmayan dar bir veritabanı yüzeyiyle doğrudan sınarız.
    const scopedDb = { activity: testDb.activity } as unknown as ReportDb;
    const report = await readReportForScope(
      scopedDb,
      scope,
      "activities",
      "month",
      undefined,
      NOW,
    );

    expect(report?.scope).toEqual(scope);
  });

  it("izin ve bildirim özetleri kapsam dışı kişileri saymaz", async () => {
    const { branchViewer } = await sahne();

    const absence = await readReport(
      testDb,
      { id: branchViewer.id },
      "absence",
      "month",
      undefined,
      NOW,
    );
    const notifications = await readReport(
      testDb,
      { id: branchViewer.id },
      "notifications",
      "month",
      undefined,
      NOW,
    );

    if (!absence || absence.data.tab !== "absence") throw new Error("İzin raporu okunamadı");
    if (!notifications || notifications.data.tab !== "notifications") throw new Error("Bildirim raporu okunamadı");

    expect(absence.data).toMatchObject({
      periods: 1,
      people: 1,
      approvedDays: 3,
      pendingDays: 0,
    });
    expect(notifications.data).toMatchObject({
      total: 2,
      sent: 1,
      pending: 0,
      failed: 1,
    });
    expect("payload" in notifications.data).toBe(false);
    expect(JSON.stringify(notifications.data)).not.toContain("özel bildirim");
  });

  it("skor raporu ayrı yetki ister ve takdir katkısını gösterir", async () => {
    const { viewer, branchViewer } = await sahne();

    expect(
      await readReport(
      testDb,
      { id: branchViewer.id },
        "scores",
        "month",
        undefined,
        NOW,
      ),
    ).toBeNull();

    const report = await readReport(
      testDb,
      { id: viewer.id },
      "scores",
      "month",
      undefined,
      NOW,
    );
    if (!report || report.data.tab !== "scores") throw new Error("Skor raporu okunamadı");

    expect(report.data).toMatchObject({
      periods: 1,
      people: 1,
      averageTotal: 85,
      appreciationCount: 1,
      appreciationPoints: 2,
    });
  });

  it("geri bildirim özeti yalnız sistem yöneticisine açıktır ve içerik taşımaz", async () => {
    const { viewer, branchViewer } = await sahne();

    expect(
      await readReport(
      testDb,
      { id: branchViewer.id },
        "feedback",
        "month",
        undefined,
        NOW,
      ),
    ).toBeNull();

    const report = await readReport(
      testDb,
      { id: viewer.id },
      "feedback",
      "month",
      undefined,
      NOW,
    );
    if (!report || report.data.tab !== "feedback") throw new Error("Geri bildirim raporu okunamadı");

    expect(report.data).toMatchObject({ total: 2, newCount: 1, resolved: 1 });
    expect(JSON.stringify(report.data)).not.toContain("Detay rapora");

    const globalReport = await readReport(
      testDb,
      { id: viewer.id },
      "feedback",
      "month",
      "00000000-0000-0000-0000-000000000000",
      NOW,
    );
    expect(globalReport?.selectedScope.rootOrgUnitId).toBe(globalReport?.scope.rootOrgUnitId);
  });
});
