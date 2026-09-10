import { PrismaClient } from "@prisma/client";

import { DEMO_DEFAULT_PASSWORD, installDemoData } from "@/server/demo/data";

// Örnek veri kurulumunun komut satırı sarmalayıcısı.
//
// İşin kendisi `src/server/demo/data.ts` içinde: yönetim ekranındaki "Örnek
// veri yükle" düğmesi de aynı modülü çağırır. Kurulumun iki ayrı yerde
// yazılması, ikisinin zamanla ayrışması demek olurdu.

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_FORCE !== "evet") {
    console.log(
      "[örnek veri] NODE_ENV=production: kurulmadı. Bilerek istiyorsanız DEMO_FORCE=evet verin.",
    );
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient();
  const parola = process.env.DEMO_PASSWORD ?? DEMO_DEFAULT_PASSWORD;

  try {
    const sonuc = await installDemoData(db, {
      password: parola,
      onLog: (satir) => console.log(`[örnek veri] ${satir}`),
    });

    if (!sonuc.ok) {
      console.log("[örnek veri] Kök birim yok. Önce `pnpm kurulum` çalıştırın.");
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log(`  Örnek kullanıcıların parolası: ${parola}`);
    console.log("  Örnek giriş: emre.aslan@ornek.test (Genel Müdür — tüm şirketi görür)");
    console.log("               fatma.kaliphane@ornek.test (Kalıphane Müdürü — kendi birimi)");
    console.log("               yasin.meral@ornek.test (Sistem yöneticisi + Bilgi İşlem yöneticisi)");
    console.log("               yigit.kaliphane@ornek.test (çalışan — yalnız kendi kayıtları)");
    console.log("               yonetim.kurulu@ornek.test (takdir verebilen yönetici)");
    console.log("");
  } finally {
    await db.$disconnect();
  }
}

main();
