import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { createOrgUnit } from "@/server/org/tree";
import { createUser } from "@/server/users/create";

// İlk kurulum (§17.2): boş bir veritabanına kök birim ve **ilk sistem
// yöneticisi** hesabını açar. Bu hesap olmadan hiçbir ekrana girilemez ve
// sistemde kullanıcı açacak kimse bulunmaz — "yumurta–tavuk" adımı budur.
//
// Betik **yalnızca eksik olanı** kurar: kök birim ya da sistem yöneticisi
// zaten varsa dokunmaz ve durumu söyler. İkinci kez çalıştırmak zararsızdır.
//
// Kullanım:
//   pnpm kurulum                                  → parola üretilir, ekrana yazılır
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm kurulum
//
// Parola argüman olarak alınmaz: komut satırı geçmişine ve süreç listesine
// düşerdi.

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.test";
const FULL_NAME = process.env.ADMIN_NAME ?? "System Administrator";
const ROOT_NAME = process.env.ROOT_UNIT_NAME ?? "Acme Corp";

function log(message: string): void {
  console.log(`[setup] ${message}`);
}

async function main(): Promise<void> {
  const db = new PrismaClient();

  try {
    const mevcutYonetici = await db.user.findFirst({
      where: { isSystemAdmin: true, isActive: true },
      select: { email: true },
    });

    if (mevcutYonetici) {
      log(`A system administrator already exists: ${mevcutYonetici.email}`);
      log("Use that account to manage users via /admin/users.");
      return;
    }

    let root = await db.orgUnit.findFirst({ where: { parentId: null } });

    if (root) {
      log(`Root unit already exists: "${root.name}"`);
    } else {
      const olusan = await createOrgUnit(db, {
        name: ROOT_NAME,
        type: "Root",
        parentId: null,
        sortOrder: 0,
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      });

      if (!olusan.ok) {
        log(`Failed to create root unit: ${olusan.message}`);
        process.exitCode = 1;
        return;
      }

      root = olusan.value;
      log(`Root unit created: "${root.name}"`);
    }

    // Parola verilmediyse üretilir. Üretilen parola **yalnız burada** görünür;
    // hiçbir yere yazılmaz.
    const password =
      process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");

    const sonuc = await createUser(
      db,
      {
        fullName: FULL_NAME,
        email: EMAIL,
        orgUnitId: root.id,
        // Kök birimin yöneticisi: tüm şirketi görür (§4.4).
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

    if (!sonuc.ok) {
      log(`Failed to create account: ${sonuc.message}`);
      process.exitCode = 1;
      return;
    }

    log("System administrator account created.");
    console.log("");
    console.log(`  Email   : ${sonuc.user.email}`);
    console.log(`  Password: ${password}`);
    console.log("");
    log("Change this password after first login via /parola.");
  } finally {
    await db.$disconnect();
  }
}

main();
