import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  decideNoActivityPeriod,
  listTeamAbsences,
  markNoActivityPeriod,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import {
  resolveAbsenceApproversForUser,
} from "@/server/absence/approval-routing";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

const NOW = new Date("2026-08-22T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function sirket() {
  const kok = await createOrgUnit({ name: "Şirket", type: "Kök" });
  const genelMudurluk = await createOrgUnit({
    name: "Genel Müdürlük",
    parentId: kok.id,
  });
  const kaliphane = await createOrgUnit({ name: "Kalıphane", parentId: genelMudurluk.id });
  const planlama = await createOrgUnit({ name: "Planlama", parentId: genelMudurluk.id });

  const genelMudur = await createUser(genelMudurluk.id, {
    fullName: "Genel Müdür",
    isUnitManager: true,
  });
  const kaliphaneMuduru = await createUser(kaliphane.id, {
    fullName: "Kalıphane Müdürü",
    isUnitManager: true,
  });
  const planlamaMuduru = await createUser(planlama.id, {
    fullName: "Planlama Müdürü",
    isUnitManager: true,
  });
  const calisan = await createUser(kaliphane.id, { fullName: "Kalıphane Çalışanı" });

  return { genelMudur, kaliphaneMuduru, planlamaMuduru, calisan };
}

async function yoneticiIzniKur(
  genelMudurId: string,
  kaliphaneMuduruId: string,
  deputyId?: string,
) {
  const result = await markNoActivityPeriod(
    testDb,
    genelMudurId,
    {
      userId: kaliphaneMuduruId,
      startDate: "2026-08-20",
      endDate: "2026-08-27",
      ...(deputyId ? { deputyId } : {}),
    },
    NOW,
  );

  if (!result.ok) throw new Error(`Yönetici izni kurulamadı: ${result.message}`);
  return result;
}

describe("izin karar yolu", () => {
  it("aktif yöneticiyi doğrudan yetkili yapar, üst yöneticiyi yetkisiz bırakır", async () => {
    const { genelMudur, kaliphaneMuduru, calisan } = await sirket();

    const approvers = await resolveAbsenceApproversForUser(testDb, calisan.id, NOW);
    expect(approvers).toEqual([{ id: kaliphaneMuduru.id, route: "DIRECT_MANAGER" }]);

    const request = await markOwnNoActivityPeriod(
      testDb,
      calisan.id,
      { startDate: "2026-09-01", endDate: "2026-09-03" },
      NOW,
    );
    if (!request.ok) throw new Error("Talep kurulamadı");

    const upperDecision = await decideNoActivityPeriod(
      testDb,
      genelMudur.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(upperDecision.ok).toBe(false);
    if (!upperDecision.ok) expect(upperDecision.error).toBe("not_found");

    const directDecision = await decideNoActivityPeriod(
      testDb,
      kaliphaneMuduru.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(directDecision.ok).toBe(true);
  });

  it("izinli yöneticinin aktif vekiline geçer ve listede vekilin kararı görünür", async () => {
    const { genelMudur, kaliphaneMuduru, planlamaMuduru, calisan } = await sirket();
    await yoneticiIzniKur(genelMudur.id, kaliphaneMuduru.id, planlamaMuduru.id);

    const approvers = await resolveAbsenceApproversForUser(testDb, calisan.id, NOW);
    expect(approvers).toEqual([{ id: planlamaMuduru.id, route: "DEPUTY" }]);

    const request = await markOwnNoActivityPeriod(
      testDb,
      calisan.id,
      { startDate: "2026-09-01", endDate: "2026-09-03" },
      NOW,
    );
    if (!request.ok) throw new Error("Talep kurulamadı");

    const notification = await testDb.notificationQueue.findFirst({
      where: {
        userId: planlamaMuduru.id,
        eventType: NOTIFICATION_EVENTS.absenceRequestSubmitted,
      },
    });
    expect(notification).not.toBeNull();

    const decision = await decideNoActivityPeriod(
      testDb,
      planlamaMuduru.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(decision.ok).toBe(true);

    const list = await listTeamAbsences(
      testDb,
      planlamaMuduru.id,
      undefined,
      { userId: calisan.id },
      { now: NOW },
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      userName: "Kalıphane Çalışanı",
      decidedByName: "Planlama Müdürü",
      decisionRoute: "DEPUTY",
    });
  });

  it("vekâlet yoksa ilk aktif üst yöneticiye geçer", async () => {
    const { genelMudur, kaliphaneMuduru, planlamaMuduru, calisan } = await sirket();
    await yoneticiIzniKur(genelMudur.id, kaliphaneMuduru.id);

    const approvers = await resolveAbsenceApproversForUser(testDb, calisan.id, NOW);
    expect(approvers).toEqual([{ id: genelMudur.id, route: "UPPER_MANAGER" }]);

    const request = await markOwnNoActivityPeriod(
      testDb,
      calisan.id,
      { startDate: "2026-09-01", endDate: "2026-09-03" },
      NOW,
    );
    if (!request.ok) throw new Error("Talep kurulamadı");

    const deputyDecision = await decideNoActivityPeriod(
      testDb,
      planlamaMuduru.id,
      request.id,
      "APPROVED",
      "",
      NOW,
    );
    expect(deputyDecision.ok).toBe(false);

    const upperDecision = await decideNoActivityPeriod(
      testDb,
      genelMudur.id,
      request.id,
      "REJECTED",
      "Tarihleri yeniden kontrol edin.",
      NOW,
    );
    expect(upperDecision.ok).toBe(true);

    const list = await listTeamAbsences(
      testDb,
      genelMudur.id,
      undefined,
      { userId: calisan.id },
      { now: NOW },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.decisionRoute).toBe("UPPER_MANAGER");
  });
});
