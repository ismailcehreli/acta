import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import {
  AUDIT_ACTIONS,
  AUDIT_OBJECTS,
  recordAudit,
  type AuditDb,
} from "@/server/audit/log";

// Marka ayarları: logo, sayfa başlığı ve alt şerit metni.
//
// Üst çubukta **yalnız logo** durur. "Şirket adı" diye ayrı bir alan vardı ve
// logonun yanına da yazılıyordu; ürün sahibi kaldırılmasını istedi (19.08.2026)
// çünkü aynı şeyi iki kez söylüyor ve logoyu sıkıştırıyordu. Ad yerine iki
// somut alan geldi: tarayıcı sekmesinde görünen **sayfa başlığı** ve sayfanın
// altındaki **alt şerit metni**.
//
// Logo dosya olarak saklanır, veritabanında değil: küçük de olsa ikili veriyi
// her sayfa yüklemesinde satırla birlikte taşımak gereksiz. Dosya adı
// **sunucuda** belirlenir (§15.4 ile aynı gerekçe: kullanıcının verdiği ad
// diske yazılmaz).

const BRANDING_DIR =
  process.env.BRANDING_STORAGE_DIR ??
  path.join(process.cwd(), "storage", "branding");

const KEYS = {
  /** Eski ad alanı; değeri sayfa başlığına taşındı, artık okunmuyor. */
  companyName: "company_name",
  pageTitle: "page_title",
  footerText: "footer_text",
  logoExtension: "company_logo_extension",
} as const;

/** İzin verilen logo türleri; içerik imzasından doğrulanır. */
const ALLOWED = new Map<string, { extension: string; signature: number[] }>([
  ["image/png", { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47] }],
  ["image/jpeg", { extension: "jpg", signature: [0xff, 0xd8, 0xff] }],
  ["image/svg+xml", { extension: "svg", signature: [] }],
]);

export const LOGO_MAX_BYTES = 512 * 1024;

export type BrandingDb = Pick<PrismaClient, "systemSetting" | "$transaction"> &
  AuditDb;

export interface Branding {
  /** Tarayıcı sekmesinde görünen başlık; logo alternatif metni de bundan gelir. */
  pageTitle: string;
  /** Sayfanın altındaki şerit metni. */
  footerText: string;
  /** Logo varsa servis adresi; yoksa `null`. */
  logoUrl: string | null;
}

export const DEFAULT_PAGE_TITLE = "Faaliyet Raporlama Sistemi";
export const DEFAULT_FOOTER_TEXT = "Faaliyet Raporlama Sistemi";

/** Logo dosyası gerçekten okunabiliyor mu? */
async function logoDosyasiVar(uzanti: string): Promise<boolean> {
  try {
    await access(path.join(BRANDING_DIR, `logo.${uzanti}`));
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

  const uzanti = map.get(KEYS.logoExtension) ?? "";
  // Eski kurulumlarda değer `company_name`de duruyor olabilir; ayar ekranından
  // ilk kayıtta yeni anahtara taşınır. Okuma tarafı ikisini de kabul eder ki
  // güncelleme sonrası başlık bir anda varsayılana düşmesin.
  const baslik = map.get(KEYS.pageTitle) || map.get(KEYS.companyName) || "";

  // Ayar "logo var" diyorsa dosyanın gerçekten durduğu doğrulanır.
  //
  // İkisi ayrışabiliyor: ayar satırı veritabanında, dosya diskte. Depolama
  // dizini temizlenirse ya da kurulum başka bir birime taşınırsa satır kalır,
  // dosya gider. O durumda sayfa **kırık bir resim** çiziyordu — hem de
  // giriş ekranında, kullanıcının gördüğü ilk şeyde.
  //
  // Sessizce gizlemek de doğru değil (sessiz hata yok): tutarsızlık günlüğe
  // yazılır, sistem yöneticisi logoyu yeniden yükleyebilsin diye.
  let logoUrl: string | null = null;
  if (uzanti) {
    if (await logoDosyasiVar(uzanti)) {
      // Adrese uzantı eklenir ki tarayıcı önbelleği logo değişince tazelensin.
      logoUrl = `/api/branding/logo?v=${uzanti}`;
    } else {
      console.error(
        `[marka] Logo ayarı "${uzanti}" diyor ama dosya yok: ${path.join(BRANDING_DIR, `logo.${uzanti}`)} — logo gösterilmiyor.`,
      );
    }
  }

  return {
    pageTitle: baslik || DEFAULT_PAGE_TITLE,
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
  const kayitlar = [
    {
      key: KEYS.pageTitle,
      value: texts.pageTitle.trim(),
      description: "Tarayıcı sekmesinde görünen sayfa başlığı",
    },
    {
      key: KEYS.footerText,
      value: texts.footerText.trim(),
      description: "Sayfanın altındaki şerit metni",
    },
  ];

  // Ayar değişikliği ve izi **aynı işlemde** (§15.2): "ayar değişti ama izi
  // yok" durumu mümkün olmamalı (denetim 21.08.2026, bulgu 14).
  await db.$transaction(async (tx) => {
    for (const kayit of kayitlar) {
      await tx.systemSetting.upsert({
        where: { key: kayit.key },
        update: { value: kayit.value },
        create: kayit,
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
  | { ok: false; message: string };

function imzaUyuyor(content: Buffer, signature: number[]): boolean {
  if (signature.length === 0) return true;
  return signature.every((byte, index) => content[index] === byte);
}

export async function saveLogo(
  db: BrandingDb,
  file: { type: string; content: Buffer },
  actorId: string,
  now: Date = new Date(),
): Promise<LogoResult> {
  const izin = ALLOWED.get(file.type);
  if (!izin) {
    return { ok: false, message: "Yalnız PNG, JPEG ve SVG yüklenebilir." };
  }

  if (file.content.byteLength === 0) {
    return { ok: false, message: "Dosya boş." };
  }

  if (file.content.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, message: "Logo en fazla 512 KB olabilir." };
  }

  // Tür, uzantıya değil içerik imzasına göre doğrulanır (§15.4).
  if (!imzaUyuyor(file.content, izin.signature)) {
    return { ok: false, message: "Dosya içeriği türüyle uyuşmuyor." };
  }

  await mkdir(BRANDING_DIR, { recursive: true });
  // Eski logo silinir: iki farklı uzantı yan yana kalırsa hangisinin geçerli
  // olduğu belirsizleşir.
  await removeLogoFiles();
  await writeFile(path.join(BRANDING_DIR, `logo.${izin.extension}`), file.content);

  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: KEYS.logoExtension },
      update: { value: izin.extension },
      create: {
        key: KEYS.logoExtension,
        value: izin.extension,
        description: "Yüklenen logonun dosya uzantısı",
      },
    });

    await recordAudit(tx, {
      userId: actorId,
      objectType: AUDIT_OBJECTS.setting,
      objectId: "branding_logo",
      action: AUDIT_ACTIONS.logoChanged,
      detail: { extension: izin.extension, sizeBytes: file.content.byteLength },
      now,
    });
  });

  return { ok: true };
}

async function removeLogoFiles(): Promise<void> {
  for (const uzanti of ["png", "jpg", "svg"]) {
    await unlink(path.join(BRANDING_DIR, `logo.${uzanti}`)).catch(() => undefined);
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

/** Servis edilecek logo; yoksa `null`. */
export async function loadLogo(db: BrandingDb): Promise<LogoFile | null> {
  const row = await db.systemSetting.findUnique({
    where: { key: KEYS.logoExtension },
  });
  if (!row) return null;

  const tur = [...ALLOWED.entries()].find(
    ([, deger]) => deger.extension === row.value,
  );
  if (!tur) return null;

  try {
    const content = await readFile(path.join(BRANDING_DIR, `logo.${row.value}`));
    return { content, contentType: tur[0] };
  } catch {
    return null;
  }
}
