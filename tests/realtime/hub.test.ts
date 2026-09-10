import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REALTIME_EVENTS, type RealtimeEvent } from "@/server/realtime/events";
import { shutdownRealtimeHub, subscribe, subscriberCount } from "@/server/realtime/hub";
import { publishRealtimeEvent } from "@/server/realtime/publish";

import { testDatabaseUrl, testDb } from "../helpers/test-db";

// Gerçek zamanlı akışın **sızdırmadığının** kanıtı (§18.4, Görev 7.3).
//
// Bu testler gerçek PostgreSQL bildirimi kullanır: NOTIFY/LISTEN'ı taklit eden
// bir test, kanalın gerçekten çalıştığını değil, taklidin çalıştığını
// gösterirdi. Hub `DATABASE_URL`'i okuduğu için test veritabanına yönlendirilir.

const originalDatabaseUrl = process.env.DATABASE_URL;

// İki farklı kişi. Kimliklerin UUID olması şart: yük şeması bunu doğruluyor.
const AHMET = "11111111-1111-4111-8111-111111111111";
const BURCU = "22222222-2222-4222-8222-222222222222";

/** Olay gelene kadar bekler; gelmezse `null` döner. */
function bekle(
  kutu: RealtimeEvent[],
  ms = 2_000,
): Promise<RealtimeEvent | null> {
  return new Promise((resolve) => {
    const baslangic = Date.now();
    const kontrol = () => {
      if (kutu.length > 0) return resolve(kutu[0]!);
      if (Date.now() - baslangic > ms) return resolve(null);
      setTimeout(kontrol, 20);
    };
    kontrol();
  });
}

beforeEach(() => {
  process.env.DATABASE_URL = testDatabaseUrl;
});

afterEach(async () => {
  await shutdownRealtimeHub();
  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("gerçek zamanlı dağıtım", () => {
  it("olay yalnızca adı geçen kullanıcıya gider", async () => {
    const ahmetin: RealtimeEvent[] = [];
    const burcununki: RealtimeEvent[] = [];

    const birak1 = await subscribe(AHMET, (e) => ahmetin.push(e));
    const birak2 = await subscribe(BURCU, (e) => burcununki.push(e));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.questionAsked,
        userIds: [AHMET],
      });

      const gelen = await bekle(ahmetin);
      expect(gelen).toEqual({ kind: REALTIME_EVENTS.questionAsked });

      // Asıl iddia bu: Burcu'nun akışına **hiçbir şey** düşmedi.
      expect(burcununki).toEqual([]);
    } finally {
      birak1();
      birak2();
    }
  });

  it("aynı kullanıcının iki sekmesi de haberi alır", async () => {
    const sekme1: RealtimeEvent[] = [];
    const sekme2: RealtimeEvent[] = [];

    const birak1 = await subscribe(AHMET, (e) => sekme1.push(e));
    const birak2 = await subscribe(AHMET, (e) => sekme2.push(e));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.answerReceived,
        userIds: [AHMET],
      });

      expect(await bekle(sekme1)).not.toBeNull();
      expect(await bekle(sekme2)).not.toBeNull();
    } finally {
      birak1();
      birak2();
    }
  });

  it("abonelik bırakılınca akışa yazılmaz", async () => {
    const kutu: RealtimeEvent[] = [];
    const birak = await subscribe(AHMET, (e) => kutu.push(e));
    birak();

    await publishRealtimeEvent(testDb, {
      kind: REALTIME_EVENTS.questionAsked,
      userIds: [AHMET],
    });

    expect(await bekle(kutu, 500)).toBeNull();
    expect(subscriberCount()).toBe(0);
  });

  it("bozuk yük dağıtılmaz ve dinleyiciyi düşürmez", async () => {
    const kutu: RealtimeEvent[] = [];
    const birak = await subscribe(AHMET, (e) => kutu.push(e));

    try {
      // Şemaya uymayan yük doğrudan kanala basılır.
      await testDb.$executeRawUnsafe(
        "SELECT pg_notify($1, $2)",
        "faaliyet_olay",
        JSON.stringify({ kind: "olmayan_tur", userIds: [AHMET] }),
      );

      expect(await bekle(kutu, 500)).toBeNull();

      // Dinleyici hâlâ ayakta: geçerli olay geliyor.
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.questionAsked,
        userIds: [AHMET],
      });

      expect(await bekle(kutu)).toEqual({ kind: REALTIME_EVENTS.questionAsked });
    } finally {
      birak();
    }
  });
});

describe("yayım", () => {
  it("alıcı yoksa hiç yayımlanmaz", async () => {
    // Çağrı hata vermemeli ve kanala bir şey basmamalı. Basılsaydı, aşağıdaki
    // abone onu görürdü.
    const kutu: RealtimeEvent[] = [];
    const birak = await subscribe(AHMET, (e) => kutu.push(e));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.questionAsked,
        userIds: [],
      });

      expect(await bekle(kutu, 400)).toBeNull();
    } finally {
      birak();
    }
  });

  it("uzun alıcı listesi parçalara bölünür ve hepsi ulaşır", async () => {
    // 8000 baytlık `pg_notify` sınırını tek yükle aşacak kadar kimlik üretilir;
    // bölme çalışmazsa PostgreSQL hata verir ve test kırmızıya döner.
    const kimlikler = Array.from({ length: 400 }, (_, i) => {
      const s = i.toString(16).padStart(12, "0");
      return `33333333-3333-4333-8333-${s}`;
    });

    const kutu: RealtimeEvent[] = [];
    const sonKimlik = kimlikler[kimlikler.length - 1]!;
    const birak = await subscribe(sonKimlik, (e) => kutu.push(e));

    try {
      await publishRealtimeEvent(testDb, {
        kind: REALTIME_EVENTS.activityCancelled,
        userIds: kimlikler,
      });

      // Son parçadaki kimliğe de ulaşması, bölmenin kimseyi düşürmediğini
      // gösterir.
      expect(await bekle(kutu)).toEqual({
        kind: REALTIME_EVENTS.activityCancelled,
      });
    } finally {
      birak();
    }
  });
});
