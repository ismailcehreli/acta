import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// Takip maddesi değişmezleri (§11.1).
//
// Kısıtın değeri, **uygulama katmanı devre dışıyken de** geçerli olmasındadır:
// doğrudan veritabanına yazan bir betik de bu kuralları atlayamaz.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function hazirla() {
  const unit = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const kisi = await createUser(unit.id, { fullName: "Kişi" });
  const activity = await createActivity(kisi, { approvalStatus: "APPROVED" });
  return { kisi, activity };
}

describe("takip maddesi kısıtları", () => {
  it("aynı faaliyetin ikinci açık maddesi reddedilir", async () => {
    const { kisi, activity } = await hazirla();
    await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
    });

    // Prisma tekillik hatasını çeviriyor ve indeks adını göstermiyor; bu
    // yüzden alan adına bakılıyor. Kısıtın **kısmi** olduğu bir alttaki test
    // ile kanıtlanıyor.
    await expect(
      testDb.followUpItem.create({
        data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it("kapanan maddenin yanına yenisi açılabilir", async () => {
    const { kisi, activity } = await hazirla();
    const ilk = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
    });
    await testDb.followUpItem.update({
      where: { id: ilk.id },
      data: {
        status: "CLOSED",
        closedById: kisi.id,
        closedAt: new Date(),
        closingNote: "Bitti.",
      },
    });

    // Kısmi indeks yalnız açık maddeleri kapsıyor.
    const ikinci = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
    });
    expect(ikinci.status).toBe("OPEN");
  });

  it("notsuz kapatma reddedilir", async () => {
    const { kisi, activity } = await hazirla();
    const madde = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
    });

    await expect(
      testDb.followUpItem.update({
        where: { id: madde.id },
        data: { status: "CLOSED", closedById: kisi.id, closedAt: new Date() },
      }),
    ).rejects.toThrow(/FollowUpItem_closing_note_matches_status/);
  });

  it("açık maddede kapanış notu duramaz", async () => {
    const { kisi, activity } = await hazirla();

    await expect(
      testDb.followUpItem.create({
        data: {
          activityId: activity.id,
          openedById: kisi.id,
          ownerId: kisi.id,
          closingNote: "Artakalan not",
        },
      }),
    ).rejects.toThrow(/FollowUpItem_closing_note_matches_status/);
  });

  it("kapatan kişi olmadan kapatılamaz", async () => {
    const { kisi, activity } = await hazirla();
    const madde = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
    });

    // "Kim kapattı" sorusu sonradan sorulamaz hâle gelmemeli.
    await expect(
      testDb.followUpItem.update({
        where: { id: madde.id },
        data: { status: "CLOSED", closingNote: "Bitti.", closedAt: new Date() },
      }),
    ).rejects.toThrow(/FollowUpItem_closer_matches_status/);
  });

  it("kullanılan madde silinemez", async () => {
    const { kisi, activity } = await hazirla();
    const madde = await testDb.followUpItem.create({
      data: { activityId: activity.id, openedById: kisi.id, ownerId: kisi.id },
    });
    await testDb.followUpItemEvent.create({
      data: { followUpId: madde.id, kind: "OPENED", actorId: kisi.id },
    });

    // Fiziksel silme yok (§16.6); yabancı anahtar da engelliyor.
    await expect(
      testDb.followUpItem.delete({ where: { id: madde.id } }),
    ).rejects.toThrow();
  });
});
