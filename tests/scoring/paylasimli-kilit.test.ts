import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  acquireScoreClosureLock,
  acquireScoreMutationLock,
} from "@/server/scoring/recalculation";

import { testDatabaseUrl } from "../helpers/test-db";

// P8-R4-2 — faaliyet mutasyonları birbirini dışlamaz; yalnız kapanış onları
// kısa süreliğine durdurur. Gerçek PostgreSQL advisory lock davranışı iki
// bağlantıyla ölçülür; tek bağlantı kilit beklemesini gizler.

const first = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const second = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const third = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const TEST_LOCK_KEY = "faaliyet:skor_kapanisi:paylasimli_kilit_testi";

afterAll(async () => {
  await Promise.all([first.$disconnect(), second.$disconnect(), third.$disconnect()]);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("skor kapanışı paylaşımlı kilidi", () => {
  it("normal iki mutasyon birbirini beklemez, kapanış onları dışlar", async () => {
    const firstLocked = deferred();
    const releaseFirst = deferred();
    const firstMutation = first.$transaction(async (tx) => {
      await acquireScoreMutationLock(tx, TEST_LOCK_KEY);
      firstLocked.resolve();
      await releaseFirst.promise;
    });
    await firstLocked.promise;
    const secondMutation = second.$transaction((tx) =>
      acquireScoreMutationLock(tx, TEST_LOCK_KEY),
    );
    const releaseClosure = deferred();
    let closeMutation: Promise<unknown> | null = null;

    try {
      // Eski dışlayıcı kilitte bu transaction ilk mutasyon serbest kalana kadar
      // dönmezdi. Paylaşımlı modda hemen tamamlanmalıdır.
      await Promise.race([
        secondMutation,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ikinci mutasyon bekledi")), 500)),
      ]);

      const closureEntered = deferred();
      closeMutation = third.$transaction(async (tx) => {
        await acquireScoreClosureLock(tx, TEST_LOCK_KEY);
        closureEntered.resolve();
        await releaseClosure.promise;
      });

      // Dışlayıcı kapanış, açık paylaşımlı mutasyon bitmeden geçemez.
      await expect(
        Promise.race([
          closureEntered.promise.then(() => "entered"),
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 120)),
        ]),
      ).resolves.toBe("waiting");

      releaseFirst.resolve();
      await firstMutation;
      await expect(closureEntered.promise).resolves.toBeUndefined();

      const afterClosureMutation = second.$transaction((tx) =>
        acquireScoreMutationLock(tx, TEST_LOCK_KEY),
      );
      // Kapanış dışlayıcı kilidi aldıktan sonra yeni normal yazı, karne ile
      // kuyruk kararının arasına giremez.
      await expect(
        Promise.race([
          afterClosureMutation.then(() => "entered"),
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 120)),
        ]),
      ).resolves.toBe("waiting");

      releaseClosure.resolve();
      await closeMutation;
      await afterClosureMutation;
    } finally {
      releaseFirst.resolve();
      releaseClosure.resolve();
      await firstMutation;
      await secondMutation;
      await closeMutation;
    }
  });
});
