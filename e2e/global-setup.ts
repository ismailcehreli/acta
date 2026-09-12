import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/server/auth/password";
import { assertTestDatabaseUrl } from "../tests/helpers/assert-test-database";
import { prepareTestDatabase } from "../tests/helpers/prepare-test-database";
import {
  assertSentinelPresent,
  isRequiredSchemaPresent,
} from "../tests/helpers/test-db";




//




export const E2E_USER = {
  fullName: "Test Manager",
  title: "Mold Shop Manager",
  email: "e2e@example.test",
};


export const E2E_ADMIN = {
  fullName: "System Administrator",
  title: "IT Specialist",
  email: "e2e-admin@example.test",
};



//




export const E2E_CHAIRMAN = {
  fullName: "Board Chair",
  title: "Board Chair",
  email: "e2e-chair@example.test",
};

export const E2E_GM = {
  fullName: "General Manager",
  title: "General Manager",
  email: "e2e-gm@example.test",
};

export const E2E_WORKER = {
  fullName: "Mold Shop Employee",
  title: "Mold Operator",
  email: "e2e-worker@example.test",
};

export const E2E_PLANNER = {
  fullName: "Planning Manager",
  title: "Production Planning Manager",
  email: "e2e-planning@example.test",
};



//





//


export const E2E_DYE_MANAGER = {
  fullName: "Paint Shop Manager",
  title: "Paint Shop Manager",
  email: "e2e-paint-manager@example.test",
};

export const E2E_DYER = {
  fullName: "Paint Shop Employee",
  title: "Paint Operator",
  email: "e2e-paint-operator@example.test",
};


export function e2ePassword(): string {
  const password = process.env.E2E_PASSWORD;

  if (!password) {
    throw new Error(
      "E2E_PASSWORD is missing; global setup may not have run.",
    );
  }

  return password;
}

export function e2eDatabaseUrl(): string {
  return assertTestDatabaseUrl(process.env.E2E_DATABASE_URL, {
    variableName: "E2E_DATABASE_URL",
    applicationUrl: process.env.DATABASE_URL,
  });
}

export default async function globalSetup(): Promise<void> {


  // Prepare and validate the isolated E2E database (2026-08-18, Phase 4,
  // finding 12).
  await prepareTestDatabase({
    resolveUrl: e2eDatabaseUrl,
    assertSentinel: assertSentinelPresent,
    runMigrations: (target) => {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: target },
        stdio: "inherit",
      });
    },
    isSchemaReady: isRequiredSchemaPresent,
    resetDatabase: (target) => {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "reset", "--force"], {
        env: { ...process.env, DATABASE_URL: target },
        stdio: "inherit",
      });
    },
  });

  const url = e2eDatabaseUrl();

  const password = randomBytes(18).toString("base64url");
  process.env.E2E_PASSWORD = password;

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {


    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length > 0) {
      const quoted = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
      );
    }

    const root = await prisma.orgUnit.create({
      data: { name: "Company", type: "Root" },
    });
    const generalManagement = await prisma.orgUnit.create({
      data: { name: "General Management", type: "General Management", parentId: root.id },
    });
    const moldShop = await prisma.orgUnit.create({
      data: { name: "Mold Shop", type: "Department", parentId: generalManagement.id },
    });
    const planning = await prisma.orgUnit.create({
      data: { name: "Planning", type: "Department", parentId: generalManagement.id },
    });
    // Permanently requires approval; no test changes this flag.
    const dyeHouse = await prisma.orgUnit.create({
      data: {
        name: "Paint Shop",
        type: "Department",
        parentId: generalManagement.id,
        requiresApproval: true,
      },
    });

    // Decision-reason catalog. Migrations seed it, but setup truncates tables;
    // the decision screen cannot operate without reasons.
    await prisma.approvalReason.createMany({
      data: [
        { kind: "CHANGES_REQUESTED", label: "Insufficient information", sortOrder: 10 },
        { kind: "CHANGES_REQUESTED", label: "Other", sortOrder: 90 },
        { kind: "REJECTED", label: "Not an activity", sortOrder: 10 },
        { kind: "REJECTED", label: "Duplicate record", sortOrder: 20 },
        { kind: "REJECTED", label: "Other", sortOrder: 90 },
      ],
    });

    const passwordHash = await hashPassword(password);

    for (const account of [
      {
        ...E2E_CHAIRMAN,
        unitId: root.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: true,
        canViewScoreReports: true,
      },
      {
        ...E2E_ADMIN,
        unitId: root.id,
        isUnitManager: false,
        isSystemAdmin: true,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_GM,
        unitId: generalManagement.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: true,
        canViewScoreReports: false,
      },
      {
        ...E2E_USER,
        unitId: moldShop.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_WORKER,
        unitId: moldShop.id,
        isUnitManager: false,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_PLANNER,
        unitId: planning.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_DYE_MANAGER,
        unitId: dyeHouse.id,
        isUnitManager: true,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
      {
        ...E2E_DYER,
        unitId: dyeHouse.id,
        isUnitManager: false,
        isSystemAdmin: false,
        canViewReports: false,
        canViewScoreReports: false,
      },
    ]) {
      const user = await prisma.user.upsert({
        where: { email: account.email },
        update: {
          isActive: true,
          isSystemAdmin: account.isSystemAdmin,
          canViewReports: account.canViewReports,
          canViewScoreReports: account.canViewScoreReports,
          title: account.title,
        },
        create: {
          fullName: account.fullName,
          // Titles are shown in lists and activity details; the fixture should
          // represent the actual screen.
          title: account.title,
          email: account.email,
          orgUnitId: account.unitId,
          isUnitManager: account.isUnitManager,
          isSystemAdmin: account.isSystemAdmin,
          canViewReports: account.canViewReports,
          canViewScoreReports: account.canViewScoreReports,
        },
      });

      await prisma.userCredential.upsert({
        where: { userId: user.id },
        update: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        create: { userId: user.id, passwordHash },
      });

      // Revoke sessions left by previous runs.
      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
