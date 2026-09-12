import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const layout = readFileSync(resolve(ROOT, "src/app/layout.tsx"), "utf8");
const css = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");
const pkg = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

describe("production fonts", () => {
  it("does not connect to Google Fonts CDN during build", () => {
    expect(layout).not.toContain('from "next/font/google"');
    expect(css).not.toMatch(/https?:\/\//);
  });

  it("uses version-pinned official IBM packages", () => {
    expect(pkg.dependencies?.["@ibm/plex-sans"]).toBe("1.1.0");
    expect(pkg.dependencies?.["@ibm/plex-mono"]).toBe("2.5.0");
  });

  it("binds full WOFF2 faces supporting Turkish glyphs", () => {
    for (const file of [
      "IBMPlexSans-Regular.woff2",
      "IBMPlexSans-Medium.woff2",
      "IBMPlexSans-SemiBold.woff2",
      "IBMPlexSans-Bold.woff2",
      "IBMPlexMono-Regular.woff2",
      "IBMPlexMono-Medium.woff2",
      "IBMPlexMono-SemiBold.woff2",
    ]) {
      expect(css, `${file} should be bound in local CSS`).toContain(file);
    }
  });
});
