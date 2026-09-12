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
const AUGUST = new Date("2026-08-01T00:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setup() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const operations = await createOrgUnit({
    name: "Operations Directorate",
    type: "Directorate",
    parentId: root.id,
  });
  const planning = await createOrgUnit({
    name: "Planning Directorate",
    type: "Directorate",
    parentId: root.id,
  });
  const outside = await createOrgUnit({
    name: "Finance Directorate",
    type: "Directorate",
    parentId: root.id,
  });

  const viewer = await createUser(root.id, {
    fullName: "Board of Directors",
    isSystemAdmin: true,
    canViewReports: true,
    canViewScoreReports: true,
  });
  const branchViewer = await createUser(operations.id, {
    fullName: "Operations Director",
    isUnitManager: true,
    canViewReports: true,
    canViewScoreReports: false,
  });
  const workerA = await createUser(operations.id, {
    fullName: "Operations Specialist",
  });
  const workerB = await createUser(planning.id, {
    fullName: "Planning Specialist",
  });
  const outsideWorker = await createUser(outside.id, {
    fullName: "Finance Specialist",
  });

  const activityA = await createActivity(workerA, {
    title: "Operations record",
    activityDate: new Date("2026-08-20T00:00:00.000Z"),
    approvalStatus: "APPROVED",
  });
  await createActivity(workerB, {
    title: "Planning record",
    activityDate: new Date("2026-08-21T00:00:00.000Z"),
    approvalStatus: "APPROVED",
  });
  await createActivity(outsideWorker, {
    title: "Finance record",
    activityDate: new Date("2026-08-22T00:00:00.000Z"),
    approvalStatus: "APPROVED",
  });
  await createActivity(workerA, {
    title: "Pending operations record",
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
        payload: { privateText: "activity text must not be in report" },
        idempotencyKey: "report-test-a-sent",
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
      },
      {
        userId: workerA.id,
        eventType: "approval_pending",
        channel: "PUSH",
        status: "FAILED",
        payload: { privateText: "private notification content" },
        idempotencyKey: "report-test-a-failed",
        createdAt: new Date("2026-08-21T10:00:00.000Z"),
      },
      {
        userId: workerB.id,
        eventType: "absence_request_submitted",
        channel: "EMAIL",
        status: "PENDING",
        payload: { privateText: "another private content" },
        idempotencyKey: "report-test-b-pending",
        createdAt: new Date("2026-08-22T10:00:00.000Z"),
      },
      {
        userId: outsideWorker.id,
        eventType: "activity_approved",
        channel: "EMAIL",
        status: "SENT",
        payload: { privateText: "out of scope" },
        idempotencyKey: "report-test-outside",
        createdAt: new Date("2026-08-22T10:00:00.000Z"),
      },
    ],
  });

  await testDb.userScorePeriod.create({
    data: {
      userId: workerA.id,
      periodStart: AUGUST,
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
      periodStart: AUGUST,
      activityId: activityA.id,
      kind: "APPRECIATION",
      happenedOn: new Date("2026-08-20T00:00:00.000Z"),
    },
  });
  await testDb.userScorePeriod.update({
    where: {
      userId_periodStart_revisionNo: {
        userId: workerA.id,
        periodStart: AUGUST,
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
        title: "Search issue",
        description: "Details must not be in report.",
        status: "RESOLVED",
        createdAt: new Date("2026-08-20T08:00:00.000Z"),
        readAt: new Date("2026-08-20T10:00:00.000Z"),
        reviewedAt: new Date("2026-08-20T12:00:00.000Z"),
        resolvedAt: new Date("2026-08-21T08:00:00.000Z"),
      },
      {
        submittedById: workerB.id,
        category: "SUGGESTION",
        title: "New filter",
        description: "Another detail must not be in report.",
        status: "NEW",
        createdAt: new Date("2026-08-22T08:00:00.000Z"),
      },
    ],
  });

  // Reports preserve history: earlier records of a user whose account is deactivated
  // should not drop out of the period summary. A passive account cannot start new operations;
  // here only historical entry inclusion in report is tested.
  await testDb.user.update({
    where: { id: workerA.id },
    data: { isActive: false },
  });

  return { root, operations, planning, viewer, branchViewer, workerA };
}

describe("report read", () => {
  it("calculates period starts according to company day", () => {
    expect(reportPeriodRange("month", NOW)).toMatchObject({
      startDay: "2026-08-01",
      endDay: "2026-08-29",
    });
    expect(reportPeriodRange("quarter", NOW).startDay).toBe("2026-07-01");
    expect(reportPeriodRange("year", NOW).startDay).toBe("2026-01-01");
    expect(reportPeriodRange("all", NOW).startDay).toBeNull();
  });

  it("senior manager sees total of their tree and subunits", async () => {
    const { viewer, operations, planning } = await setup();

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
    if (!report || report.data.tab !== "activities") throw new Error("Report could not be read");

    expect(report.data).toMatchObject({
      total: 4,
      approved: 3,
      pending: 1,
      people: 3,
    });
    expect(report.data.units.map((unit) => unit.name)).toEqual([
      "Company",
      "Finance Directorate",
      "Operations Directorate",
      "Planning Directorate",
    ]);
    expect(report.data.units[0]).toMatchObject({
      activities: 4,
      people: 3,
    });
  });

  it("branch manager only sees their own branch", async () => {
    const { branchViewer, operations, planning } = await setup();

    const report = await readReport(
      testDb,
      { id: branchViewer.id },
      "activities",
      "month",
      undefined,
      NOW,
    );

    expect(report?.selectedScope.rootOrgUnitId).toBe(operations.id);
    if (!report || report.data.tab !== "activities") throw new Error("Report could not be read");
    expect(report.data.total).toBe(2);
    expect(report.data.units.map((unit) => unit.name)).not.toContain(
      "Planning Directorate",
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

  it("returns no aggregated data for user without report permission", async () => {
    const { workerA } = await setup();

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

  it("does not re-query previously calculated scope", async () => {
    const { viewer } = await setup();
    const scope = await visibleReportScope(testDb, viewer.id);
    if (!scope) throw new Error("Report scope could not be read");

    // We directly test with a narrow database surface without a user delegate
    // that the core path does not recompute the scope.
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

  it("absence and notification summaries do not count out of scope users", async () => {
    const { branchViewer } = await setup();

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

    if (!absence || absence.data.tab !== "absence") throw new Error("Absence report could not be read");
    if (!notifications || notifications.data.tab !== "notifications") throw new Error("Notification report could not be read");

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
    expect(JSON.stringify(notifications.data)).not.toContain("private notification");
  });

  it("score report requires separate permission and shows appreciation contribution", async () => {
    const { viewer, branchViewer } = await setup();

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
    if (!report || report.data.tab !== "scores") throw new Error("Score report could not be read");

    expect(report.data).toMatchObject({
      periods: 1,
      people: 1,
      averageTotal: 85,
      appreciationCount: 1,
      appreciationPoints: 2,
    });
  });

  it("feedback summary is only visible to system admin and carries no content", async () => {
    const { viewer, branchViewer } = await setup();

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
    if (!report || report.data.tab !== "feedback") throw new Error("Feedback report could not be read");

    expect(report.data).toMatchObject({ total: 2, newCount: 1, resolved: 1 });
    expect(JSON.stringify(report.data)).not.toContain("Details must not");

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
