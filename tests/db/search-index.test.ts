import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// §16.2: Search runs over Turkish full-text index. These tests verify the index is installed
// and resolves Turkish word stems. Visibility scoping is handled by authz layers.

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

describe("full-text search index", () => {
  it("index is installed", async () => {
    const rows = await testDb.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Activity' AND indexname = 'Activity_fulltext_idx'
    `;

    expect(rows).toHaveLength(1);
  });

  it("finds content written with suffixed word using root stem", async () => {
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

  it("finds words appearing in description", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await createActivity(user, {
      title: "Vardiya devri",
      description: "Yedek parça beklendiği için hat durdu.",
    });

    expect(await searchTitles("yedek parça")).toEqual(["Vardiya devri"]);
  });

  it("returns empty result when no match found", async () => {
    const unit = await createOrgUnit();
    const user = await createUser(unit.id);

    await createActivity(user, {
      title: "Kalıphane bakımı",
      description: "Kalıpta çatlak tespit edildi.",
    });

    expect(await searchTitles("muhasebe")).toEqual([]);
  });
});
