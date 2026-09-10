import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { recordReadFromTicket } from "@/server/reads/service";
import {
  issueReadTicket,
  READ_TICKET_MAX_AGE_MS,
  verifyReadTicket,
} from "@/server/reads/ticket";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Denetim (18.08.2026, FAZ 4 bulgu 8): süreyi istemci beyan ediyordu.
// Detay ekranı hiç açılmadan "iki saniye geçti" denebiliyor, başkasının sahte
// okuması yazarın düzeltme hakkını kapatabiliyordu.

const SECRET = "test-icin-en-az-otuz-iki-karakterlik-anahtar";
const NOW = new Date("2026-08-17T09:00:00.000Z");

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function scenario() {
  const root = await createOrgUnit({ name: "Genel Müdürlük", type: "Kök" });
  const unit = await createOrgUnit({ name: "Kalıphane", parentId: root.id });
  const reader = await createUser(root.id, { fullName: "Direktör", isUnitManager: true });
  const author = await createUser(unit.id, { fullName: "Müdür", isUnitManager: true });

  const activity = await testDb.activity.create({
    data: {
      authorId: author.id,
      authorOrgUnitId: unit.id,
      activityDate: new Date("2026-08-17T00:00:00.000Z"),
      title: "Başlık",
      description: "Açıklama",
      approvalStatus: "APPROVED",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return { reader, author, activity };
}

describe("bilet doğrulaması", () => {
  const ACTIVITY = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";

  it("süreyi sunucu ölçer", () => {
    const bilet = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const sonuc = verifyReadTicket(
      bilet,
      ACTIVITY,
      USER,
      new Date(NOW.getTime() + 2_500),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: true, dwellMs: 2_500 });
  });

  it("başka faaliyet için üretilmiş bilet kabul edilmez", () => {
    const bilet = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const sonuc = verifyReadTicket(
      bilet,
      "33333333-3333-4333-8333-333333333333",
      USER,
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: false, reason: "invalid" });
  });

  it("başkasının bileti kabul edilmez", () => {
    const bilet = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const sonuc = verifyReadTicket(
      bilet,
      ACTIVITY,
      "44444444-4444-4444-8444-444444444444",
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: false, reason: "invalid" });
  });

  it("uydurma bilet ve bozuk biçim reddedilir", () => {
    const now = new Date(NOW.getTime() + 3_000);
    for (const sahte of [
      `${NOW.getTime()}.abc`,
      "imzasiz",
      ".",
      `${NOW.getTime()}.${"0".repeat(64)}`,
    ]) {
      expect(verifyReadTicket(sahte, ACTIVITY, USER, now, SECRET).ok).toBe(false);
    }
  });

  it("başka anahtarla imzalanmış bilet kabul edilmez", () => {
    const bilet = issueReadTicket(ACTIVITY, USER, NOW, "baska-bir-anahtar-en-az-otuz-iki-karakter");
    const sonuc = verifyReadTicket(
      bilet,
      ACTIVITY,
      USER,
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: false, reason: "invalid" });
  });

  it("sekmede unutulan sayfa okuma üretmez", () => {
    const bilet = issueReadTicket(ACTIVITY, USER, NOW, SECRET);
    const sonuc = verifyReadTicket(
      bilet,
      ACTIVITY,
      USER,
      new Date(NOW.getTime() + READ_TICKET_MAX_AGE_MS + 1),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: false, reason: "expired" });
  });

  it("gelecekten gelen bilet reddedilir", () => {
    const bilet = issueReadTicket(ACTIVITY, USER, new Date(NOW.getTime() + 60_000), SECRET);

    expect(verifyReadTicket(bilet, ACTIVITY, USER, NOW, SECRET)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("okuma kaydı bilet üzerinden düşer", () => {
  it("iki saniye dolunca kaydedilir", async () => {
    const { reader, activity } = await scenario();
    const bilet = issueReadTicket(activity.id, reader.id, NOW, SECRET);

    const sonuc = await recordReadFromTicket(
      testDb,
      { id: reader.id, isSystemAdmin: false },
      activity.id,
      bilet,
      new Date(NOW.getTime() + 2_000),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: true, recorded: true });
    expect(await testDb.readReceipt.count()).toBe(1);
  });

  it("iki saniye dolmadan gönderilen bilet kayıt bırakmaz", async () => {
    const { reader, activity } = await scenario();
    const bilet = issueReadTicket(activity.id, reader.id, NOW, SECRET);

    const sonuc = await recordReadFromTicket(
      testDb,
      { id: reader.id, isSystemAdmin: false },
      activity.id,
      bilet,
      new Date(NOW.getTime() + 1_999),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: false, reason: "too_short" });
    expect(await testDb.readReceipt.count()).toBe(0);
  });

  // Bulgunun özü: detay ekranını hiç açmadan okuma kaydı üretilemez.
  it("biletsiz çağrı okuma kaydı üretemez", async () => {
    const { reader, activity } = await scenario();

    for (const sahte of ["", "9999999999999.deadbeef", `${NOW.getTime()}.`]) {
      const sonuc = await recordReadFromTicket(
        testDb,
        { id: reader.id, isSystemAdmin: false },
        activity.id,
        sahte,
        new Date(NOW.getTime() + 10_000),
        SECRET,
      );

      expect(sonuc).toEqual({ ok: false, reason: "invalid_ticket" });
    }

    expect(await testDb.readReceipt.count()).toBe(0);
  });

  it("bileti olsa da göremeyen kişi okuma kaydı üretemez", async () => {
    const { author, activity } = await scenario();
    const yabanci = await createUser(
      (await testDb.orgUnit.findFirstOrThrow({ where: { name: "Kalıphane" } })).id,
      { fullName: "Akran" },
    );
    // Bilet doğru imzalı: yetki kararı yine görünürlük modülünden gelir.
    const bilet = issueReadTicket(activity.id, yabanci.id, NOW, SECRET);

    const sonuc = await recordReadFromTicket(
      testDb,
      { id: yabanci.id, isSystemAdmin: false },
      activity.id,
      bilet,
      new Date(NOW.getTime() + 3_000),
      SECRET,
    );

    expect(sonuc).toEqual({ ok: false, reason: "not_visible" });
    expect(await testDb.readReceipt.count()).toBe(0);
    expect(author.id).toBeTruthy();
  });
});
