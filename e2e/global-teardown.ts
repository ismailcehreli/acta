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

// Koşu bitince test hesabı kapatılır: oturumlar iptal edilir, parola
// kullanılamaz hâle getirilir, kullanıcı pasifleştirilir. Kayıt silinmez —
// fiziksel silme yoktur (§16.6).

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

      // Açık konuşması olan kullanıcı pasifleştirilemez (§4.6, veritabanı
      // kısıtı). Koşu sırasında açılan konuşmalar önce idari olarak kapatılır.
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
          // Gerekçe zorunludur (§9.3, veritabanı kısıtı). Koşu sonu temizliği
          // de gerçek bir idari kapatmadır; nedeni kayda geçer.
          closeReason: "Uçtan uca koşu sonu temizliği.",
        },
      });

      await prisma.userCredential.update({
        where: { userId: user.id },
        // Kimsenin bilmediği bir parola: hesap koşu dışında kullanılamaz.
        data: {
          passwordHash: await hashPassword(randomBytes(24).toString("hex")),
        },
      });

      // Sistem yöneticisi **pasifleştirilmez**: en az bir aktif sistem
      // yöneticisi kalmalı (veritabanı değişmezi, denetim 21.08.2026,
      // bulgu 6). Hesabı kullanılamaz kılan şey zaten yukarıdaki parola
      // karıştırmasıdır; pasifleştirme ikinci bir kemerdi.
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
