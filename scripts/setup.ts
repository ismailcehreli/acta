import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { createOrgUnit } from "@/server/org/tree";
import { createUser } from "@/server/users/create";

// Initial setup: provisions the root org unit and the first system administrator
// in a clean database. Without this initial account, no other users can be created.
//
// The script only provisions what is missing: if the root unit or system admin
// already exists, it leaves them untouched. Running this multiple times is idempotent.
//
// Usage:
//   pnpm setup
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm setup

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.test";
const FULL_NAME = process.env.ADMIN_NAME ?? "System Administrator";
const ROOT_NAME = process.env.ROOT_UNIT_NAME ?? "Acme Corp";

function log(message: string): void {
  console.log(`[setup] ${message}`);
}

async function main(): Promise<void> {
  const db = new PrismaClient();

  try {
    const existingAdmin = await db.user.findFirst({
      where: { isSystemAdmin: true, isActive: true },
      select: { email: true },
    });

    if (existingAdmin) {
      log(`A system administrator already exists: ${existingAdmin.email}`);
      log("Use that account to manage users via /admin/users.");
      return;
    }

    let root = await db.orgUnit.findFirst({ where: { parentId: null } });

    if (root) {
      log(`Root unit already exists: "${root.name}"`);
    } else {
      const created = await createOrgUnit(db, {
        name: ROOT_NAME,
        type: "Root",
        parentId: null,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      });

      if (!created.ok) {
        log(`Failed to create root unit: ${created.message}`);
        process.exitCode = 1;
        return;
      }

      root = created.value;
      log(`Root unit created: "${root.name}"`);
    }

    // Generate random password if not supplied
    const password =
      process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");

    const result = await createUser(
      db,
      {
        fullName: FULL_NAME,
        email: EMAIL,
        orgUnitId: root.id,
        isUnitManager: true,
        isSystemAdmin: true,
        canViewReports: true,
        canViewScoreReports: true,
        writesActivities: true,
        initialPassword: password,
      },
      null,
      new Date(),
      { root: true },
    );

    if (!result.ok) {
      log(`Failed to create account: ${result.message}`);
      process.exitCode = 1;
      return;
    }

    log("System administrator account created.");
    console.log("");
    console.log(`  Email   : ${result.user.email}`);
    console.log(`  Password: ${password}`);
    console.log("");
    log("Change this password after first login via /password.");
  } finally {
    await db.$disconnect();
  }
}

main();
