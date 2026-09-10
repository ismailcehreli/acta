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

const EMAIL = process.env.ADMIN_EMAIL ?? "yonetici@ornek.test";
const FULL_NAME = process.env.ADMIN_NAME ?? "Sistem Yöneticisi";
const ROOT_NAME = process.env.ROOT_UNIT_NAME ?? "Şirket";

function log(message: string): void {
  console.log(`[kurulum] ${message}`);
}

async function main(): Promise<void> {
  const db = new PrismaClient();

  try {
    const mevcutYonetici = await db.user.findFirst({
      where: { isSystemAdmin: true, isActive: true },
      select: { email: true },
    });

    if (mevcutYonetici) {
      log(`Zaten bir sistem yöneticisi var: ${mevcutYonetici.email}`);
      log("Yeni hesap açmak için o hesapla /admin/users ekranını kullanın.");
      return;
    }

    let root = await db.orgUnit.findFirst({ where: { parentId: null } });

    if (root) {
      log(`Kök birim zaten var: "${root.name}"`);
    } else {
      const olusan = await createOrgUnit(db, {
        name: ROOT_NAME,
        type: "Kök",
        parentId: null,
        sortOrder: 0,
        // Sürüm 1'de yöneticiler onaya tabi değildir (§18.1); onay akışı
        // Sürüm 2'dedir.
        requiresApproval: false,
        autoFlowsUp: true,
        attentionGroupId: null,
      });

      if (!olusan.ok) {
        log(`Kök birim açılamadı: ${olusan.message}`);
        process.exitCode = 1;
        return;
      }

      root = olusan.value;
      log(`Kök birim açıldı: "${root.name}"`);
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
      log(`Hesap açılamadı: ${sonuc.message}`);
      process.exitCode = 1;
      return;
    }

    log("Sistem yöneticisi hesabı açıldı.");
    console.log("");
    console.log(`  E-posta: ${sonuc.user.email}`);
    console.log(`  Parola : ${password}`);
    console.log("");
    log("Bu parolayı ilk girişten sonra /parola ekranından değiştirin.");
  } finally {
    await db.$disconnect();
  }
}

main();
