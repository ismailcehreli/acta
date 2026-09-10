import { describe, expect, it } from "vitest";

import {
  decideClose,
  SUPERVISOR_TAKEOVER_BUSINESS_DAYS,
  type CloseContext,
} from "@/server/conversations/close-rules";

// §9.3 kapatma tablosunun HER satırı. Kural saf fonksiyonda olduğu için sahte
// saatle, veritabanı olmadan sınanır.

const ACILIS = new Date("2026-08-03T09:00:00.000Z"); // Pazartesi

function context(overrides: Partial<CloseContext> = {}): CloseContext {
  return {
    status: "OPEN",
    askerId: "soran",
    respondentId: "sorumlu",
    openedAt: ACILIS,
    lastAskerActionAt: ACILIS,
    now: new Date("2026-08-04T09:00:00.000Z"),
    actorId: "soran",
    actorIsSystemAdmin: false,
    actorIsAskerSupervisor: false,
    anyPartyInactive: false,
    ...overrides,
  };
}

describe("§9.3 — soruyu soran", () => {
  it("her zaman kapatabilir", () => {
    expect(decideClose(context({ actorId: "soran" }))).toEqual({
      allowed: true,
      closeType: "NORMAL",
      requiresReason: false,
    });
  });

  it("uzun süre sonra da kapatabilir", () => {
    const karar = decideClose(
      context({ actorId: "soran", now: new Date("2026-09-30T09:00:00.000Z") }),
    );
    expect(karar.allowed).toBe(true);
  });
});

describe("§9.3 — sorunun sorumlusu", () => {
  it("asla kapatamaz", () => {
    expect(decideClose(context({ actorId: "sorumlu" }))).toEqual({
      allowed: false,
      reason: "responsible_cannot_close",
    });
  });

  it("çok zaman geçse de kapatamaz", () => {
    const karar = decideClose(
      context({ actorId: "sorumlu", now: new Date("2026-12-31T09:00:00.000Z") }),
    );
    expect(karar.allowed).toBe(false);
  });

  it("sistem yöneticisi bile olsa sorumlu sıfatıyla kapatamaz", () => {
    const karar = decideClose(
      context({ actorId: "sorumlu", actorIsSystemAdmin: true }),
    );
    expect(karar).toEqual({
      allowed: false,
      reason: "responsible_cannot_close",
    });
  });
});

describe("§9.3 — soranın üstündeki yönetici", () => {
  it(`${SUPERVISOR_TAKEOVER_BUSINESS_DAYS} iş günü dolmadan kapatamaz`, () => {
    const karar = decideClose(
      context({
        actorId: "ust",
        actorIsAskerSupervisor: true,
        // 3 Ağustos Pazartesi + 9 iş günü = 14 Ağustos Cuma.
        now: new Date("2026-08-14T09:00:00.000Z"),
      }),
    );

    expect(karar).toEqual({ allowed: false, reason: "supervisor_too_early" });
  });

  it(`${SUPERVISOR_TAKEOVER_BUSINESS_DAYS} iş günü dolunca kapatabilir`, () => {
    const karar = decideClose(
      context({
        actorId: "ust",
        actorIsAskerSupervisor: true,
        // 17 Ağustos Pazartesi = 10. iş günü.
        now: new Date("2026-08-17T09:00:00.000Z"),
      }),
    );

    expect(karar).toEqual({
      allowed: true,
      closeType: "NORMAL",
      requiresReason: false,
    });
  });

  it("hafta sonu sayacı ilerletmez", () => {
    // 3–16 Ağustos arasında iki hafta sonu var; takvim günü 13 olsa da iş günü
    // 10'a ulaşmaz.
    const karar = decideClose(
      context({
        actorId: "ust",
        actorIsAskerSupervisor: true,
        now: new Date("2026-08-16T09:00:00.000Z"),
      }),
    );

    expect(karar.allowed).toBe(false);
  });

  it("resmî tatil de sayacı ilerletmez", () => {
    const karar = decideClose(
      context({
        actorId: "ust",
        actorIsAskerSupervisor: true,
        now: new Date("2026-08-17T09:00:00.000Z"),
        holidays: ["2026-08-10"],
      }),
    );

    expect(karar.allowed).toBe(false);
  });

  it("soran yeni mesaj yazınca sayaç yeniden başlar", () => {
    const karar = decideClose(
      context({
        actorId: "ust",
        actorIsAskerSupervisor: true,
        lastAskerActionAt: new Date("2026-08-14T09:00:00.000Z"),
        now: new Date("2026-08-17T09:00:00.000Z"),
      }),
    );

    expect(karar.allowed).toBe(false);
  });
});

describe("§9.3 — sistem yöneticisi", () => {
  it("idari olarak kapatabilir", () => {
    const karar = decideClose(
      context({
        actorId: "sistem",
        actorIsSystemAdmin: true,
        anyPartyInactive: true,
      }),
    );

    expect(karar).toEqual({
      allowed: true,
      closeType: "ADMINISTRATIVE",
      requiresReason: true,
    });
  });

  it("taraflar aktifken de kapatabilir — pasifleştirme sürecinin önünü açar", () => {
    // §4.6 açık konuşması olan kullanıcının pasifleştirilmesini engelliyor;
    // idari kapatma "taraf pasifse" koşuluna bağlansaydı kilit oluşurdu
    // (bkz. açık soru 10).
    const karar = decideClose(
      context({ actorId: "sistem", actorIsSystemAdmin: true }),
    );

    expect(karar).toEqual({
      allowed: true,
      closeType: "ADMINISTRATIVE",
      requiresReason: true,
    });
  });

  it("idari kapatma sorumluluk kuralını çiğnemez", () => {
    // Sistem yöneticisi aynı zamanda sorumluysa yine kapatamaz.
    const karar = decideClose(
      context({ actorId: "sorumlu", actorIsSystemAdmin: true }),
    );

    expect(karar.allowed).toBe(false);
  });
});

describe("§9.3 — ilgisiz kişi ve kapalı konuşma", () => {
  it("konuşmayla ilgisi olmayan kişi kapatamaz", () => {
    expect(decideClose(context({ actorId: "yabanci" }))).toEqual({
      allowed: false,
      reason: "not_a_party",
    });
  });

  it("kapalı konuşma yeniden kapatılamaz", () => {
    expect(decideClose(context({ status: "CLOSED" }))).toEqual({
      allowed: false,
      reason: "already_closed",
    });
  });
});
