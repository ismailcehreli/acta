import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const KOK = resolve(import.meta.dirname, "../..");
const layout = readFileSync(resolve(KOK, "src/app/layout.tsx"), "utf8");
const css = readFileSync(resolve(KOK, "src/app/globals.css"), "utf8");
const paket = JSON.parse(
  readFileSync(resolve(KOK, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

describe("üretim yazı tipleri", () => {
  it("derleme anında Google Fonts ağına çıkmaz", () => {
    expect(layout).not.toContain('from "next/font/google"');
    expect(css).not.toMatch(/https?:\/\//);
  });

  it("IBM'nin sürümü sabitlenmiş resmî paketlerini kullanır", () => {
    expect(paket.dependencies?.["@ibm/plex-sans"]).toBe("1.1.0");
    expect(paket.dependencies?.["@ibm/plex-mono"]).toBe("2.5.0");
  });

  it("Türkçe glifleri taşıyan tam WOFF2 yüzlerini bağlar", () => {
    for (const dosya of [
      "IBMPlexSans-Regular.woff2",
      "IBMPlexSans-Medium.woff2",
      "IBMPlexSans-SemiBold.woff2",
      "IBMPlexSans-Bold.woff2",
      "IBMPlexMono-Regular.woff2",
      "IBMPlexMono-Medium.woff2",
      "IBMPlexMono-SemiBold.woff2",
    ]) {
      expect(css, `${dosya} yerel CSS içinde bağlanmalı`).toContain(dosya);
    }
  });
});
