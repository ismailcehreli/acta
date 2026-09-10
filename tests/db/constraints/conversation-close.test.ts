import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createActivity, createOrgUnit, createUser } from "../../helpers/fixtures";
import { resetDatabase, testDb } from "../../helpers/test-db";

// İdari kapatmanın gerekçesi veritabanı kısıtıyla da zorlanır
// (`Conversation_close_reason_matches_type`). Kısıtın değeri, uygulama katmanı
// devre dışıyken — elle SQL, veri aktarımı — de geçerli olmasındadır.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function openConversation() {
  const unit = await createOrgUnit();
  const asker = await createUser(unit.id);
  const author = await createUser(unit.id);
  const activity = await createActivity(author, { approvalStatus: "APPROVED" });

  return testDb.conversation.create({
    data: {
      activityId: activity.id,
      askerId: asker.id,
      responsibleId: author.id,
      status: "OPEN",
    },
  });
}

describe("kapanış gerekçesi kısıtı", () => {
  it("gerekçesiz idari kapatma veritabanınca reddedilir", async () => {
    const conversation = await openConversation();

    await expect(
      testDb.conversation.update({
        where: { id: conversation.id },
        data: { status: "CLOSED", closedAt: new Date(), closeType: "ADMINISTRATIVE" },
      }),
    ).rejects.toThrow(/Conversation_close_reason_matches_type/);
  });

  it("boşluktan ibaret gerekçe de reddedilir", async () => {
    const conversation = await openConversation();

    await expect(
      testDb.conversation.update({
        where: { id: conversation.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closeType: "ADMINISTRATIVE",
          closeReason: "   ",
        },
      }),
    ).rejects.toThrow(/Conversation_close_reason_matches_type/);
  });

  it("gerekçeli idari kapatma kabul edilir", async () => {
    const conversation = await openConversation();

    const closed = await testDb.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeType: "ADMINISTRATIVE",
        closeReason: "Taraf işten ayrıldı.",
      },
    });

    expect(closed.closeReason).toBe("Taraf işten ayrıldı.");
  });

  // Her test kendi kökünü kurar; tek kök kısıtı yüzünden aynı test içinde
  // ikinci bir organizasyon açılamaz.
  it.each(["NORMAL", "CANCELLED_ACTIVITY"] as const)(
    "%s kapanışında gerekçe alanı dolamaz",
    async (closeType) => {
      const conversation = await openConversation();

      await expect(
        testDb.conversation.update({
          where: { id: conversation.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            closeType,
            closeReason: "buraya yazılmamalı",
          },
        }),
      ).rejects.toThrow(/Conversation_close_reason_matches_type/);

      // Gerekçesiz hâli geçerli olmalı.
      const closed = await testDb.conversation.update({
        where: { id: conversation.id },
        data: { status: "CLOSED", closedAt: new Date(), closeType },
      });
      expect(closed.closeType).toBe(closeType);
    },
  );
});
