import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/server/auth/password";

import {
  E2E_ADMIN,
  E2E_CHAIRMAN,
  E2E_GM,
  E2E_DYER,
  E2E_DYE_MANAGER,
  E2E_PLANNER,
  E2E_USER,
  E2E_WORKER,
  e2eDatabaseUrl,
} from "./global-setup";



// Physical deletion is never used (§16.6).

export default async function globalTeardown(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl() } } });

  try {
    for (const email of [
      E2E_USER.email,
      E2E_ADMIN.email,
      E2E_CHAIRMAN.email,
      E2E_GM.email,
      E2E_WORKER.email,
      E2E_PLANNER.email,
      E2E_DYE_MANAGER.email,
      E2E_DYER.email,
    ]) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) continue;

      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });



      await prisma.conversation.updateMany({
        where: {
          status: "OPEN",
          OR: [{ askerId: user.id }, { responsibleId: user.id }],
        },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: user.id,
          closeType: "ADMINISTRATIVE",


          closeReason: "End-to-end run cleanup.",
        },
      });

      await prisma.userCredential.update({
        where: { userId: user.id },

        data: {
          passwordHash: await hashPassword(randomBytes(24).toString("hex")),
        },
      });





      if (!user.isSystemAdmin) {
        await prisma.user.update({
          where: { id: user.id },
          data: { isActive: false },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
