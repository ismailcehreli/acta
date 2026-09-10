import { PrismaClient } from "@prisma/client";

import { assertTestDatabaseUrl } from "./assert-test-database";

// Testler her zaman ayrı bir veritabanına (Compose'daki test-postgres) koşar.
// Bağlantı adresi TEST_DATABASE_URL'den gelir; uygulamanın DATABASE_URL'i
// testlerde hiçbir koşulda kullanılmaz.

export const testDatabaseUrl = assertTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  {
    variableName: "TEST_DATABASE_URL",
    applicationUrl: process.env.DATABASE_URL,
  },
);

export const testDb = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
  // Kısıt testleri kasten hata ürettiği için Prisma'nın hata günlüğü kapalı;
  // hatalar zaten istisna olarak testin kendisine ulaşıyor.
  log: [],
});

/** Veritabanı kurulumunun bıraktığı işaret; adres doğru olsa bile hedefin
 *  gerçekten bir test veritabanı olduğunun ikinci kanıtıdır. Tablo değil
 *  veritabanı yorumudur: tablo olsaydı Prisma şemayı "boş değil" sayardı. */
export const SENTINEL_COMMENT = "faaliyet-test-veritabani";

/**
 * İşaret tablosunun varlığını doğrular. Adres kontrolü yapılandırmayı denetler,
 * bu kontrol ise hedefin kendisini: veritabanı kurulumundan geçmemiş bir
 * veritabanı boşaltılamaz.
 *
 * İşareti **veritabanı kurulumu** koyar (`docker/postgres-init/`), test süreci
 * değil; kendi koyduğu işareti doğrulamak bağımsız kanıt olmazdı
 * (denetim 18.08.2026, bulgu 8).
 */
async function readSentinel(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<string | null> {
  const rows = await client.$queryRaw<{ note: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS note
    FROM pg_database
    WHERE datname = current_database()
  `;

  return rows[0]?.note ?? null;
}

export async function assertSentinelPresent(url: string): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url } } });

  try {
    if ((await readSentinel(client)) !== SENTINEL_COMMENT) {
      throw new Error(
        `Hedef veritabanında test işareti yok ("${SENTINEL_COMMENT}"). İşareti ` +
          "veritabanı kurulumu koyar (docker/postgres-init); bu veritabanı bir " +
          "test veritabanı değil.",
      );
    }
  } finally {
    await client.$disconnect();
  }
}

/**
 * Migration geçmişi dururken şema yarım kalmış olabilir. Bu en az iki temel
 * tabloyu ham SQL ile doğrular; Prisma model çağrısı eksik tabloda P2021
 * fırlatacağı için kurulumun nedenini gizlerdi.
 */
export async function isRequiredSchemaPresent(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rows = await client.$queryRaw<
      { userTable: string | null; settingsTable: string | null }[]
    >`
      SELECT
        to_regclass('public."User"')::text AS "userTable",
        to_regclass('public."SystemSetting"')::text AS "settingsTable"
    `;
    return rows[0]?.userTable !== null && rows[0]?.settingsTable !== null;
  } finally {
    await client.$disconnect();
  }
}

async function assertSentinel(): Promise<void> {
  if ((await readSentinel(testDb)) !== SENTINEL_COMMENT) {
    throw new Error(
      "Hedef veritabanında test işareti yok; kurulumdan geçmemiş bir " +
        "veritabanı boşaltılamaz.",
    );
  }
}

/**
 * Tüm tabloları boşaltır. Tablo listesi veritabanından okunur; şemaya yeni
 * tablo eklendiğinde bu yardımcının güncellenmesi gerekmez — unutulan bir tablo
 * yüzünden testlerin birbirine sızması böylece imkânsızlaşır.
 */
export async function resetDatabase(): Promise<void> {
  await assertSentinel();

  const tables = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations' 
  `;

  if (tables.length === 0) {
    throw new Error(
      "Test veritabanında tablo yok — migration uygulanmamış olabilir.",
    );
  }

  const quoted = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );
}
