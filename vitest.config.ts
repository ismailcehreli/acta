import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// The test database URL is read from .env (TEST_DATABASE_URL).
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
    // End-to-end tests run with Playwright and must not be collected by Vitest.
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // Database tests share the same test database and empty it before each test;
    // parallel files would delete one another's data.
    fileParallelism: false,
    globalSetup: ["tests/helpers/global-setup.ts"],
    testTimeout: 20_000,
  },
});
