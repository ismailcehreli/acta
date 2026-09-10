import { readFileSync } from "node:fs";
import path from "node:path";

// Uygulama sürümü.
//
// Tek kaynak `package.json`: sürüm numarasını iki yerde tutmak, ikisinin
// zamanla ayrışması demektir. Dosya **bir kez** okunur ve bellekte kalır;
// her sayfa çiziminde diske gitmenin anlamı yok.
//
// Okuma başarısız olursa uygulama ayağa kalkmaya devam eder: alt şeritte
// sürüm yazmaması, sistemin çalışmamasından iyidir. Hata yutulmuyor,
// günlüğe yazılıyor.

function oku(): string {
  try {
    const ham = readFileSync(
      path.join(process.cwd(), "package.json"),
      "utf8",
    );
    const paket = JSON.parse(ham) as { version?: unknown };

    return typeof paket.version === "string" ? paket.version : "";
  } catch (error) {
    console.error("[sürüm] package.json okunamadı:", error);
    return "";
  }
}

export const APP_VERSION = oku();
