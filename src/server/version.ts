import { readFileSync } from "node:fs";
import path from "node:path";


//



//




function readAppVersion(): string {
  try {
    const rawPackage = readFileSync(
      path.join(process.cwd(), "package.json"),
      "utf8",
    );
    const packageJson = JSON.parse(rawPackage) as { version?: unknown };

    return typeof packageJson.version === "string" ? packageJson.version : "";
  } catch (error) {
    console.error("[version] Could not read package.json:", error);
    return "";
  }
}

export const APP_VERSION = readAppVersion();
