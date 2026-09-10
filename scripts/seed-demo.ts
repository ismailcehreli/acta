import { PrismaClient } from "@prisma/client";

import { DEMO_DEFAULT_PASSWORD, installDemoData } from "@/server/demo/data";

// Örnek veri kurulumunun komut satırı sarmalayıcısı.
//
// İşin kendisi `src/server/demo/data.ts` içinde: yönetim ekranındaki "Örnek
// veri yükle" düğmesi de aynı modülü çağırır. Kurulumun iki ayrı yerde
// yazılması, ikisinin zamanla ayrışması demek olurdu.

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_FORCE !== "yes" && process.env.DEMO_FORCE !== "evet") {
    console.log(
      "[demo data] NODE_ENV=production: aborted. Set DEMO_FORCE=yes to force run.",
    );
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient();
  const parola = process.env.DEMO_PASSWORD ?? DEMO_DEFAULT_PASSWORD;

  try {
    const sonuc = await installDemoData(db, {
      password: parola,
      onLog: (satir) => console.log(`[demo data] ${satir}`),
    });

    if (!sonuc.ok) {
      console.log("[demo data] Root organizational unit missing. Run `pnpm setup` or `pnpm kurulum` first.");
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log(`  Demo users password: ${parola}`);
    console.log("  Sample logins: alex.morgan@example.test (Chief Executive Officer — company-wide scope)");
    console.log("                 amanda.tooling@example.test (Tooling Manager — department scope)");
    console.log("                 marcus.it@example.test (System Admin + IT Lead)");
    console.log("                 oliver.tooling@example.test (Team Member — individual activities)");
    console.log("                 board@example.test (Board Member — executive appreciation)");
    console.log("");
  } finally {
    await db.$disconnect();
  }
}

main();
