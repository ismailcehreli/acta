import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { en } from "@/shared/i18n/messages/en";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function hasMessage(key: string): boolean {
  let current: unknown = en;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string";
}

function literalTranslationKeys(): string[] {
  const sourceRoot = fileURLToPath(new URL("../../src", import.meta.url));
  const keys = new Set<string>();
  const pattern = /\bt\(\s*["']([^"']+)["']\s*(?=[,)])/g;

  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) keys.add(match[1]);
  }

  return [...keys].sort();
}

describe("English message catalog", () => {
  it("contains every literal translation key used by the source", () => {
    const missing = literalTranslationKeys().filter((key) => !hasMessage(key));
    expect(missing).toEqual([]);
  });
});
