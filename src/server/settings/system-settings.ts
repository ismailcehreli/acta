import type { PrismaClient } from "@prisma/client";

import type { ActivityTextLimits } from "@/shared/schemas/activity";

import { AUDIT_ACTIONS, AUDIT_OBJECTS, recordAudit } from "@/server/audit/log";

import { parseDomainList } from "./email-domains";
import {
  findSetting,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SETTING_PAIR_RULES,
  SETTING_SUM_RULES,
  validateSettingValue,
} from "./registry";

// Sistem ayarlarının okunması ve yazılması (§16.5). Varsayılanlar koda gömülü
// değil, kayıt defterinde; veritabanındaki kayıt varsa onun yerini alır.
// Böylece bir değeri değiştirmek için sürüm çıkmak gerekmez.

export { SETTING_KEYS };

export type SettingsDb = Pick<PrismaClient, "systemSetting">;

/** Tüm ayarların güncel değerleri; kayıt yoksa varsayılan. */
export async function readAllSettings(
  db: SettingsDb,
): Promise<Record<string, string>> {
  const rows = await db.systemSetting.findMany();
  const kayitli = new Map(rows.map((row) => [row.key, row.value]));

  const sonuc: Record<string, string> = {};
  for (const definition of SETTING_DEFINITIONS) {
    sonuc[definition.key] = kayitli.get(definition.key) ?? definition.defaultValue;
  }

  return sonuc;
}

async function readRaw(db: SettingsDb, key: string): Promise<string> {
  const definition = findSetting(key);
  if (!definition) {
    // Defterde olmayan anahtar bir programlama hatasıdır; sessizce bir
    // varsayılana düşmek yanlış davranışı gizlerdi.
    throw new Error(`Tanımsız ayar anahtarı: ${key}`);
  }

  const row = await db.systemSetting.findUnique({ where: { key } });
  if (!row) return definition.defaultValue;

  // Bozuk bir kayıt sistemi durdurmaz ama sessiz de kalmaz.
  const dogrulama = validateSettingValue(definition, row.value);
  if (!dogrulama.ok) {
    console.error(
      `[ayar] "${key}" geçersiz ("${row.value}"): ${dogrulama.message} ` +
        `Varsayılan ${definition.defaultValue} kullanılıyor.`,
    );
    return definition.defaultValue;
  }

  return dogrulama.value;
}

/** Tek bir ayarı, kayıtta yoksa kayıt defterindeki varsayılanıyla okur. */
export async function readSettingValue(
  db: SettingsDb,
  key: string,
): Promise<string> {
  return readRaw(db, key);
}

export async function readNumericSetting(
  db: SettingsDb,
  key: string,
): Promise<number> {
  return Number(await readRaw(db, key));
}

/**
 * İzinli e-posta alan adları. Bozuk kayıt varsa **kısıt kapalı** sayılır:
 * okunamayan bir kısıt yüzünden hesap açılamaz hâle gelmek, kısıtın kendisinden
 * daha büyük bir arıza olurdu — ama sessiz kalmaz, günlüğe yazılır.
 */
export async function readAllowedEmailDomains(
  db: SettingsDb,
): Promise<string[]> {
  const raw = await readRaw(db, SETTING_KEYS.allowedEmailDomains);
  const liste = parseDomainList(raw);

  if (!liste.ok) {
    console.error(`[ayar] izinli alan adları okunamadı: ${liste.message}`);
    return [];
  }

  return liste.domains;
}

export async function readBooleanSetting(
  db: SettingsDb,
  key: string,
): Promise<boolean> {
  return (await readRaw(db, key)) === "true";
}

export type SaveSettingsResult =
  | { ok: true; changed: string[] }
  | { ok: false; message: string };

/**
 * Verilen ayarları doğrulayıp yazar. **Hepsi ya da hiçbiri**: bir değer
 * geçersizse hiçbiri yazılmaz, aksi hâlde yarısı yeni yarısı eski bir
 * yapılandırma kalırdı.
 */
export async function saveSettings(
  db: SettingsDb &
    Pick<PrismaClient, "$transaction" | "$executeRaw" | "auditLog">,
  values: Record<string, string>,
  actorId: string | null = null,
  now: Date = new Date(),
): Promise<SaveSettingsResult> {
  const yazilacak: { key: string; value: string; description: string }[] = [];

  // Tek tek tür ve sınır doğrulaması girdiye bağlıdır; başka isteğin ne
  // yazdığıyla ilgisi yok, işlemden önce yapılabilir.
  for (const [key, raw] of Object.entries(values)) {
    const definition = findSetting(key);
    if (!definition) return { ok: false, message: `Tanımsız ayar: ${key}` };

    const dogrulama = validateSettingValue(definition, raw);
    if (!dogrulama.ok) return { ok: false, message: dogrulama.message };

    yazilacak.push({
      key,
      value: dogrulama.value,
      description: definition.label,
    });
  }

  // **Çapraz doğrulama okuma ile yazma arasındaki pencerede delinemez**
  // (denetim 23.08.2026, P3-4). Okuma, doğrulama ve yazma işlemin
  // dışındaydı: iki istek aynı eski görüntüyü okuyup ayrı ayrı geçerli kısmi
  // bileşimleri doğrulayabiliyor, sonra birbirinin anahtarlarını ezerek 100
  // etmeyen bir formül bırakabiliyordu. Değişmez, kaydetme sınırında
  // gerçekten zorlanmıyordu.
  //
  // Danışma kilidi ayar satırı **hiç yokken** de çalışır; satır kilidi
  // yalnız var olan satırı korurdu ve ilk kaydetmede pencere açık kalırdı.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('faaliyet:sistem_ayarlari'))`;

    const mevcut = await readAllSettings(tx);

    const sonrakiDeger = (key: string): number | null => {
      const yazilan = yazilacak.find((item) => item.key === key);
      const ham = yazilan?.value ?? mevcut[key] ?? findSetting(key)?.defaultValue;
      if (ham === undefined) return null;

      const sayi = Number(ham);
      return Number.isFinite(sayi) ? sayi : null;
    };

    for (const kural of SETTING_PAIR_RULES) {
      // Çift bu kaydetmede hiç geçmiyorsa dokunulmuyor: alakasız bir ayarı
      // değiştiren kullanıcı, önceden bozulmuş bir çift yüzünden engellenmez.
      const dokunuldu = yazilacak.some(
        (item) => item.key === kural.min || item.key === kural.max,
      );
      if (!dokunuldu) continue;

      const alt = sonrakiDeger(kural.min);
      const ust = sonrakiDeger(kural.max);
      if (alt === null || ust === null) continue;

      if (alt > ust) return { ok: false, message: kural.message };
    }

    // **Toplam kuralları.** Temel skorun tavanı her profilde 100; dört
    // ağırlığın her biri tek başına geçerli olduğu hâlde bir profilde 110
    // edebilir. Takdir katkısı bu temel toplamın dışındadır.
    for (const kural of SETTING_SUM_RULES) {
      const dokunuldu = yazilacak.some((item) => kural.keys.includes(item.key));
      if (!dokunuldu) continue;

      let toplam = 0;
      let eksik = false;

      for (const key of kural.keys) {
        const deger = sonrakiDeger(key);
        if (deger === null) {
          eksik = true;
          break;
        }
        toplam += deger;
      }

      if (eksik) continue;
      if (toplam !== kural.total) {
        return { ok: false, message: `${kural.message} Şu an ${toplam}.` };
      }
    }

    const degisen = yazilacak
      .filter((item) => mevcut[item.key] !== item.value)
      .map((item) => item.key);

    for (const item of yazilacak) {
      await tx.systemSetting.upsert({
        where: { key: item.key },
        update: { value: item.value, description: item.description },
        create: { key: item.key, value: item.value, description: item.description },
      });
    }

    // Değişiklik yoksa iz de bırakılmaz: her kaydetme düğmesine basışı kayda
    // geçirmek denetim izini gürültüye boğardı (§15.2). "Önce" değeri kilit
    // altında okunan görüntüden geliyor; bayat görüntü yanlış bir tarihçe
    // yazardı.
    if (degisen.length > 0) {
      await recordAudit(tx, {
        userId: actorId,
        objectType: AUDIT_OBJECTS.setting,
        objectId: "system",
        action: AUDIT_ACTIONS.settingsChanged,
        detail: {
          changed: degisen.map((key) => ({
            key,
            before: mevcut[key],
            after: yazilacak.find((item) => item.key === key)?.value,
          })),
        },
        now,
      });
    }

    return { ok: true, changed: degisen };
  });
}

/**
 * Faaliyet metinlerinin uzunluk sınırları (Görev 11.6).
 *
 * Doğrulama şeması bunu kullanıyor; ekran da aynı sayıları alıyor. Tek yerden
 * okunmasının sebebi bu: iki taraf ayrı okusaydı biri değiştiğinde form
 * kabul ettiğini sunucuya reddettirirdi.
 */
export async function readActivityTextLimits(
  db: SettingsDb,
): Promise<ActivityTextLimits> {
  const [titleMin, titleMax, descriptionMin, descriptionMax] = await Promise.all([
    readNumericSetting(db, SETTING_KEYS.activityTitleMinChars),
    readNumericSetting(db, SETTING_KEYS.activityTitleMaxChars),
    readNumericSetting(db, SETTING_KEYS.activityDescriptionMinChars),
    readNumericSetting(db, SETTING_KEYS.activityDescriptionMaxChars),
  ]);

  return { titleMin, titleMax, descriptionMin, descriptionMax };
}
