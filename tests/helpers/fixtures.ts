import type { Activity, OrgUnit, User } from "@prisma/client";

import { hashPassword } from "@/server/auth/password";

import { testDb } from "./test-db";

// Minimal test fixtures to keep tests readable and isolated.
// Each call generates unique names/emails so uniqueness constraints are not violated unintentionally.

let counter = 0;

function unique(): string {
  counter += 1;
  return String(counter);
}

export async function createOrgUnit(
  data: Partial<Omit<OrgUnit, "id" | "createdAt" | "updatedAt">> = {},
): Promise<OrgUnit> {
  const n = unique();
  return testDb.orgUnit.create({
    data: {
      name: data.name ?? `Unit ${n}`,
      type: data.type ?? "Department",
      ...data,
    },
  });
}

/**
 * Timestamp when the user already existed; prior to tests' mock calendar dates.
 */
const FOUNDING_TIME = new Date("2026-01-01T00:00:00.000Z");

export async function createUser(
  orgUnitId: string,
  data: Partial<Omit<User, "id" | "orgUnitId" | "updatedAt">> = {},
): Promise<User> {
  const n = unique();
  return testDb.user.create({
    data: {
      fullName: data.fullName ?? `User ${n}`,
      email: data.email ?? `user${n}@example.test`,
      orgUnitId,
      createdAt: FOUNDING_TIME,
      ...data,
    },
  });
}

export async function createActivity(
  author: Pick<User, "id" | "orgUnitId">,
  data: Partial<
    Omit<Activity, "id" | "authorId" | "authorOrgUnitId" | "createdAt" | "updatedAt">
  > = {},
): Promise<Activity> {
  const n = unique();
  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: author.orgUnitId,
      activityDate: data.activityDate ?? new Date("2026-08-17T00:00:00.000Z"),
      title: data.title ?? `Activity ${n}`,
      description: data.description ?? `Description ${n}`,
      ...data,
    },
  });

  // Automatically attach approver relationship if approverId is specified
  if (activity.approverId) {
    await testDb.activityApprover.create({
      data: { activityId: activity.id, userId: activity.approverId },
    });
  }

  // Create open approval round if status is PENDING_APPROVAL
  if (activity.approvalStatus === "PENDING_APPROVAL" && activity.approvalSubmittedAt) {
    await testDb.approvalRound.create({
      data: {
        activityId: activity.id,
        roundNo: 1,
        submittedAt: activity.approvalSubmittedAt,
      },
    });
  }

  // Decided records must carry a closed approval round
  const DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
  const decision = DECISIONS.find((d) => d === activity.approvalStatus);
  if (activity.approverId && decision) {
    const submission = activity.approvalSubmittedAt ?? activity.activityDate;
    await testDb.approvalRound.create({
      data: {
        activityId: activity.id,
        roundNo: 1,
        submittedAt: submission,
        decidedAt: activity.approvalDecidedAt ?? submission,
        decidedById: activity.approverId,
        decision,
      },
    });
  }

  return activity;
}

/**
 * Creates a user with an initialized Argon2id password hash.
 */
export async function createUserWithPassword(
  orgUnitId: string,
  password: string,
  data: Partial<Omit<User, "id" | "orgUnitId" | "createdAt" | "updatedAt">> = {},
): Promise<User> {
  const user = await createUser(orgUnitId, data);

  await testDb.userCredential.create({
    data: {
      userId: user.id,
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  return user;
}

/**
 * Creates an approval reason record for testing.
 */
export async function createApprovalReason(
  kind: "CHANGES_REQUESTED" | "REJECTED",
  label?: string,
): Promise<{ id: string; label: string }> {
  const n = unique();
  return testDb.approvalReason.create({
    data: { kind, label: label ?? `Reason ${n}`, sortOrder: 10 },
    select: { id: true, label: true },
  });
}
