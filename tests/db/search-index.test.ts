import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §16.2: arama Türkçe tam metin indeksi üzerinden çalışır. Bu testler indeksin
// kurulduğunu ve Türkçe çekim eklerini çözdüğünü gösterir. Aramanın görünürlük
// kapsamıyla sınırlanması Görev 5.2'nin konusudur — indeks yetki vermez.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function searchTitles(query: string): Promise<string[]> {
  const rows = await testDb.$queryRaw<{ title: string }[]>`
    SELECT "title"
    FROM "Activity"
    WHERE to_tsvector('turkish', "title" || ' ' || "description")
          @@ plainto_tsquery('turkish', ${query})
    ORDER BY "title"
  `;
  return rows.map((r) => r.title);
}

describe("Türkçe tam metin arama indeksi", () => {
  it("indeks kurulmuş", async () => {
    const rows = await testDb.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Activity' AND indexname = 'Activity_fulltext_idx'
    `;

    expect(rows).toHaveLength(1);
  });

  it("ek almış kelimeyle yazılan içerik kökle bulunur", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await createActivity(user, {
      title: "Kalıphane bakımı",
      description: "Kalıpta çatlak tespit edildi, onarım planlandı.",
    });
    await createActivity(user, {
      title: "Sevkiyat planı",
      description: "Haftalık sevkiyat programı güncellendi.",
    });

    expect(await searchTitles("kalıp")).toEqual(["Kalıphane bakımı"]);
  });

  it("açıklamada geçen kelime de bulunur", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await createActivity(user, {
      title: "Vardiya devri",
      description: "Yedek parça beklendiği için hat durdu.",
    });

    expect(await searchTitles("yedek parça")).toEqual(["Vardiya devri"]);
  });

  it("eşleşmeyen kelime sonuç döndürmez", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await createActivity(user, {
      title: "Kalıphane bakımı",
      description: "Kalıpta çatlak tespit edildi.",
    });

    expect(await searchTitles("muhasebe")).toEqual([]);
  });
});
