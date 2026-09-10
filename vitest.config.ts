import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Test veritabanı adresi .env dosyasından okunur (TEST_DATABASE_URL).
loadEnv();

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Uçtan uca testler Playwright ile çalışır, Vitest onları toplamamalı.
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // Veritabanı testleri aynı test veritabanını paylaşır ve her testten önce
    // onu boşaltır; paralel dosyalar birbirinin verisini silerdi.
    fileParallelism: false,
    globalSetup: ["tests/helpers/global-setup.ts"],
    testTimeout: 20_000,
  },
});
