import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  recordAudit,
  type AuditDb,
} from "@/server/audit/log";


//





//





const BRANDING_DIR =
  process.env.BRANDING_STORAGE_DIR ??
  path.join(process.cwd(), "storage", "branding");

const KEYS = {

  companyName: "company_name",
  pageTitle: "page_title",
  footerText: "footer_text",
  logoExtension: "company_logo_extension",
} as const;


const ALLOWED = new Map<string, { extension: string; signature: number[] }>([
  ["image/png", { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47] }],
  ["image/jpeg", { extension: "jpg", signature: [0xff, 0xd8, 0xff] }],
  ["image/svg+xml", { extension: "svg", signature: [] }],
]);

export const LOGO_MAX_BYTES = 512 * 1024;

export type BrandingDb = Pick<PrismaClient, "systemSetting" | "$transaction"> &
  AuditDb;

export interface Branding {
  pageTitle: string;
  footerText: string;
  /** Service URL when a logo exists; otherwise `null`. */
  logoUrl: string | null;
}

export const DEFAULT_PAGE_TITLE = "Activity Reporting System";
export const DEFAULT_FOOTER_TEXT = "Activity Reporting System";


async function logoFileExists(extension: string): Promise<boolean> {
  try {
    await access(path.join(BRANDING_DIR, `logo.${extension}`));
    return true;
  } catch {
    return false;
  }
}

export async function readBranding(db: BrandingDb): Promise<Branding> {
  const rows = await db.systemSetting.findMany({
    where: {
      key: {
        in: [KEYS.pageTitle, KEYS.footerText, KEYS.companyName, KEYS.logoExtension],
      },
    },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const extension = map.get(KEYS.logoExtension) ?? "";
  // Older installations may store the value under `company_name`; the
  // settings screen migrates it on the first save. Read both keys so a title
  // does not unexpectedly fall back to the default after an upgrade.
  const title = map.get(KEYS.pageTitle) || map.get(KEYS.companyName) || "";

  // When the setting says a logo exists, verify that the file is really there.
  //
  // The setting row is in the database while the file is on disk. If storage
  // is cleaned or the installation moves to another volume, the row can
  // remain while the file disappears. Previously the page showed a **broken
  // image**, including on the first screen users see.
  //
  // Silently hiding the inconsistency is not acceptable: log it so an
  // administrator can upload the logo again.
  let logoUrl: string | null = null;
  if (extension) {
    if (await logoFileExists(extension)) {
      // Include the extension in the URL so the browser cache refreshes after
      // a logo change.
      logoUrl = `/api/branding/logo?v=${extension}`;
    } else {
      console.error(
        `[branding] Logo setting is "${extension}", but the file is missing: ${path.join(BRANDING_DIR, `logo.${extension}`)} — logo hidden.`,
      );
    }
  }

  return {
    pageTitle: title || DEFAULT_PAGE_TITLE,
    footerText: map.get(KEYS.footerText) || DEFAULT_FOOTER_TEXT,
    logoUrl,
  };
}

export async function saveBrandingTexts(
  db: BrandingDb,
  texts: { pageTitle: string; footerText: string },
  actorId: string,
  now: Date = new Date(),
): Promise<void> {
  const records = [
    {
      key: KEYS.pageTitle,
      value: texts.pageTitle.trim(),
      description: "Page title shown in the browser tab",
    },
    {
      key: KEYS.footerText,
      value: texts.footerText.trim(),
      description: "Footer text shown at the bottom of the page",
    },
  ];



  await db.$transaction(async (tx) => {
    for (const record of records) {
      await tx.systemSetting.upsert({
        where: { key: record.key },
        update: { value: record.value },
        create: record,
      });
    }

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "branding",
      action: AUDIT_ACTIONS.brandingChanged,
      detail: { pageTitle: texts.pageTitle.trim(), footerText: texts.footerText.trim() },
      now,
    });
  });
}

export type LogoResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_type" | "empty_file" | "too_large" | "content_mismatch";
      message: string;
    };

function matchesSignature(content: Buffer, signature: number[]): boolean {
  if (signature.length === 0) return true;
  return signature.every((byte, index) => content[index] === byte);
}

export async function saveLogo(
  db: BrandingDb,
  file: { type: string; content: Buffer },
  actorId: string,
  now: Date = new Date(),
): Promise<LogoResult> {
  const allowedType = ALLOWED.get(file.type);
  if (!allowedType) {
    return {
      ok: false,
      error: "invalid_type",
      message: "Only PNG, JPEG, and SVG files can be uploaded.",
    };
  }

  if (file.content.byteLength === 0) {
    return { ok: false, error: "empty_file", message: "The file is empty." };
  }

  if (file.content.byteLength > LOGO_MAX_BYTES) {
    return {
      ok: false,
      error: "too_large",
      message: "The logo can be at most 512 KB.",
    };
  }


  if (!matchesSignature(file.content, allowedType.signature)) {
    return {
      ok: false,
      error: "content_mismatch",
      message: "The file content does not match its declared type.",
    };
  }

  await mkdir(BRANDING_DIR, { recursive: true });


  await removeLogoFiles();
  await writeFile(path.join(BRANDING_DIR, `logo.${allowedType.extension}`), file.content);

  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: KEYS.logoExtension },
      update: { value: allowedType.extension },
      create: {
        key: KEYS.logoExtension,
        value: allowedType.extension,
        description: "Uploaded logo file extension",
      },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "branding_logo",
      action: AUDIT_ACTIONS.logoChanged,
      detail: { extension: allowedType.extension, sizeBytes: file.content.byteLength },
      now,
    });
  });

  return { ok: true };
}

async function removeLogoFiles(): Promise<void> {
  for (const extension of ["png", "jpg", "svg"]) {
    await unlink(path.join(BRANDING_DIR, `logo.${extension}`)).catch(() => undefined);
  }
}

export async function removeLogo(
  db: BrandingDb,
  actorId: string,
  now: Date = new Date(),
): Promise<void> {
  await removeLogoFiles();

  await db.$transaction(async (tx) => {
    await tx.systemSetting.deleteMany({ where: { key: KEYS.logoExtension } });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "branding_logo",
      action: AUDIT_ACTIONS.logoRemoved,
      now,
    });
  });
}

export interface LogoFile {
  content: Buffer;
  contentType: string;
}

/** Logo URL when a logo exists; otherwise `null`. */
export async function loadLogo(db: BrandingDb): Promise<LogoFile | null> {
  const row = await db.systemSetting.findUnique({
    where: { key: KEYS.logoExtension },
  });
  if (!row) return null;

  const type = [...ALLOWED.entries()].find(
    ([, value]) => value.extension === row.value,
  );
  if (!type) return null;

  try {
    const content = await readFile(path.join(BRANDING_DIR, `logo.${row.value}`));
    return { content, contentType: type[0] };
  } catch {
    return null;
  }
}
