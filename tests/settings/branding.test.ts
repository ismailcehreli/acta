import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FOOTER_TEXT,
  DEFAULT_PAGE_TITLE,
  readBranding,
  removeLogo,
  saveBrandingTexts,
} from "@/server/settings/branding";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Branding texts: top navigation bar displays logo;
// browser title and footer banner text are configured.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupAdmin() {
  const unit = await createOrgUnit({ name: "Company", type: "Root" });
  return createUser(unit.id, { email: "admin@example.test", isSystemAdmin: true });
}

describe("branding texts", () => {
  it("returns defaults when no settings are persisted", async () => {
    const brand = await readBranding(testDb);

    expect(brand.pageTitle).toBe(DEFAULT_PAGE_TITLE);
    expect(brand.footerText).toBe(DEFAULT_FOOTER_TEXT);
    expect(brand.logoUrl).toBeNull();
  });

  it("reads persisted texts", async () => {
    const actor = await setupAdmin();
    await saveBrandingTexts(
      testDb,
      {
        pageTitle: "Acta Workspace",
        footerText: "Acta · Internal",
      },
      actor.id,
    );

    const brand = await readBranding(testDb);
    expect(brand.pageTitle).toBe("Acta Workspace");
    expect(brand.footerText).toBe("Acta · Internal");
  });

  it("reads legacy 'company_name' setting as page title", async () => {
    // Key name evolved; read path still recognizes legacy key.
    await testDb.systemSetting.create({
      data: { key: "company_name", value: "Legacy Name", description: "legacy" },
    });

    const brand = await readBranding(testDb);
    expect(brand.pageTitle).toBe("Legacy Name");
  });

  it("new page title takes precedence over legacy value", async () => {
    await testDb.systemSetting.create({
      data: { key: "company_name", value: "Legacy Name", description: "legacy" },
    });
    const actor = await setupAdmin();
    await saveBrandingTexts(
      testDb,
      {
        pageTitle: "New Title",
        footerText: "Footer Text",
      },
      actor.id,
    );

    const brand = await readBranding(testDb);
    expect(brand.pageTitle).toBe("New Title");
  });
});

describe("when logo file diverges from setting", () => {
  const logoDir = path.join(process.cwd(), "storage", "branding");

  async function setupLogoSetting() {
    await testDb.systemSetting.create({
      data: {
        key: "company_logo_extension",
        value: "svg",
        description: "logo type",
      },
    });
  }

  it("logo is hidden if file is missing and discrepancy is logged", async () => {
    await setupLogoSetting();
    await rm(path.join(logoDir, "logo.svg"), { force: true });

    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls: unknown[][];
    let brand;
    try {
      brand = await readBranding(testDb);
      calls = logger.mock.calls.map((c) => [...c]);
    } finally {
      logger.mockRestore();
    }

    expect(brand.logoUrl).toBeNull();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain("logo.svg");
  });

  it("returns logo URL if file exists", async () => {
    await setupLogoSetting();
    await mkdir(logoDir, { recursive: true });
    await writeFile(path.join(logoDir, "logo.svg"), "<svg/>");

    try {
      const brand = await readBranding(testDb);
      expect(brand.logoUrl).toBe("/api/branding/logo?v=svg");
    } finally {
      await rm(path.join(logoDir, "logo.svg"), { force: true });
    }
  });
});

describe("branding modifications are written to audit log", () => {
  it("text update creates audit log", async () => {
    const actor = await setupAdmin();

    await saveBrandingTexts(
      testDb,
      { pageTitle: "New title", footerText: "New footer" },
      actor.id,
    );

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "branding_changed" },
    });
    expect(log.userId).toBe(actor.id);
    expect(log.objectId).toBe("branding");
  });

  it("logo removal creates audit log", async () => {
    const actor = await setupAdmin();

    await removeLogo(testDb, actor.id);

    const log = await testDb.auditLog.findFirstOrThrow({
      where: { action: "logo_removed" },
    });
    expect(log.userId).toBe(actor.id);
  });
});
