import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { previewUnitMoveCalendar } from "@/server/calendar/move-preview";
import { DEFAULT_WORK_CALENDAR, saveWorkCalendar } from "@/server/calendar/settings";
import {
  clearUnitWorkCalendar,
  saveUnitWorkCalendar,
  WORK_WINDOW_LOCK_KEY,
} from "@/server/calendar/unit-calendar";
import { moveOrgUnit } from "@/server/org/tree";

import { createOrgUnit, createUser } from "../helpers/fixtures";
import { resetDatabase, testDb } from "../helpers/test-db";

// Hidden side effect of unit moves (audit 2026-08-23, finding 14).
//
// Move affects more than just tree visualization: unit shift window is inherited
// from parent, shifting everyone's reminder time and score denominator.

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function setupOrgTree() {
  const root = await createOrgUnit({ name: "Company", type: "Root" });
  const factory = await createOrgUnit({ name: "Factory", parentId: root.id });
  const office = await createOrgUnit({ name: "Office", parentId: root.id });
  const warehouse = await createOrgUnit({ name: "Warehouse", parentId: factory.id });
  const admin = await createUser(root.id, {
    fullName: "System Admin",
    isSystemAdmin: true,
  });

  // Factory works Saturday as well and starts early; Office is standard.
  await saveUnitWorkCalendar(testDb, factory.id, {
    workingDays: [1, 2, 3, 4, 5, 6],
    workStartMinute: 7 * 60,
    workEndMinute: 17 * 60,
    worksOnHolidays: true,
  });
  await saveUnitWorkCalendar(testDb, office.id, {
    workingDays: [1, 2, 3, 4, 5],
    workStartMinute: 9 * 60,
    workEndMinute: 18 * 60,
    worksOnHolidays: false,
  });

  return { root, factory, office, warehouse, admin };
}

describe("move preview", () => {
  it("provides both values if inherited window changes", async () => {
    const { office, warehouse } = await setupOrgTree();

    const preview = await previewUnitMoveCalendar(testDb, warehouse.id, office.id);

    expect(preview.changes).toBe(true);
    expect(preview.current.workStartMinute).toBe(7 * 60);
    expect(preview.current.worksOnHolidays).toBe(true);
    expect(preview.next.workStartMinute).toBe(9 * 60);
    expect(preview.next.worksOnHolidays).toBe(false);
    expect(preview.current.sourceUnitName).toBe("Factory");
    expect(preview.next.sourceUnitName).toBe("Office");
  });

  it("window does not change for unit with its own calendar", async () => {
    const { office, warehouse } = await setupOrgTree();
    await saveUnitWorkCalendar(testDb, warehouse.id, {
      workingDays: [1, 2, 3],
      workStartMinute: 8 * 60,
      workEndMinute: 16 * 60,
      worksOnHolidays: false,
    });

    const preview = await previewUnitMoveCalendar(testDb, warehouse.id, office.id);

    // Unit with own calendar does not inherit from parent: move does not alter window.
    expect(preview.changes).toBe(false);
  });

  it("no change between two parents carrying the same values", async () => {
    const { root, factory, warehouse } = await setupOrgTree();
    const twinFactory = await createOrgUnit({ name: "Factory 2", parentId: root.id });
    await saveUnitWorkCalendar(testDb, twinFactory.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: true,
    });

    const preview = await previewUnitMoveCalendar(testDb, warehouse.id, twinFactory.id);

    expect(factory.id).not.toBe(twinFactory.id);
    expect(preview.changes).toBe(false);
  });
});

describe("move confirmation", () => {
  it("unconfirmed move rejected if window changes", async () => {
    const { office, warehouse, admin } = await setupOrgTree();

    const result = await moveOrgUnit(
      testDb,
      { id: warehouse.id, newParentId: office.id },
      admin.id,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("calendar_change_unconfirmed");
      expect(result.calendarChange?.next.workStartMinute).toBe(9 * 60);
    }

    const fresh = await testDb.orgUnit.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(fresh.parentId).not.toBe(office.id);
  });

  it("move passes when confirmed with correct signature", async () => {
    const { office, warehouse, admin } = await setupOrgTree();
    const preview = await previewUnitMoveCalendar(testDb, warehouse.id, office.id);

    const result = await moveOrgUnit(
      testDb,
      {
        id: warehouse.id,
        newParentId: office.id,
        confirmedCalendarSignature: preview.signature,
      },
      admin.id,
    );

    expect(result.ok).toBe(true);
    const fresh = await testDb.orgUnit.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(fresh.parentId).toBe(office.id);
  });

  it("interleaving calendar change invalidates confirmation", async () => {
    const { office, warehouse, admin } = await setupOrgTree();
    const preview = await previewUnitMoveCalendar(testDb, warehouse.id, office.id);

    // Office calendar changed before admin confirmed.
    await saveUnitWorkCalendar(testDb, office.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 10 * 60,
      workEndMinute: 19 * 60,
      worksOnHolidays: false,
    });

    const result = await moveOrgUnit(
      testDb,
      {
        id: warehouse.id,
        newParentId: office.id,
        confirmedCalendarSignature: preview.signature,
      },
      admin.id,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("calendar_preview_stale");

    const fresh = await testDb.orgUnit.findUniqueOrThrow({ where: { id: warehouse.id } });
    expect(fresh.parentId).not.toBe(office.id);
  });

  it("confirmation is not required if window does not change", async () => {
    const { root, warehouse, admin } = await setupOrgTree();
    const twin = await createOrgUnit({ name: "Factory 2", parentId: root.id });
    await saveUnitWorkCalendar(testDb, twin.id, {
      workingDays: [1, 2, 3, 4, 5, 6],
      workStartMinute: 7 * 60,
      workEndMinute: 17 * 60,
      worksOnHolidays: true,
    });

    const result = await moveOrgUnit(
      testDb,
      { id: warehouse.id, newParentId: twin.id },
      admin.id,
    );

    expect(result.ok).toBe(true);
  });
});

// Window between check and write (audit 2026-08-24, P4-1).
describe("race between move and calendar write", () => {
  /** Pauses the move operation after signature check, right before write. */
  function barrierDb(ready: () => void, wait: Promise<void>) {
    return {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                if (prop !== "orgUnit") return Reflect.get(target, prop);

                const table = Reflect.get(target, prop) as {
                  update: (...args: unknown[]) => Promise<unknown>;
                };

                return new Proxy(table, {
                  get(tableTarget, tableProp) {
                    if (tableProp !== "update") {
                      return Reflect.get(tableTarget, tableProp);
                    }

                    return async (...args: unknown[]) => {
                      ready();
                      await wait;
                      return table.update(...args);
                    };
                  },
                });
              },
            }),
          ),
        )) as typeof testDb.$transaction,
    } as unknown as typeof testDb;
  }

  it("interleaving calendar write waits until move completes", async () => {
    const { office, warehouse, admin } = await setupOrgTree();
    const preview = await previewUnitMoveCalendar(testDb, warehouse.id, office.id);

    let readyCallback = () => {};
    const ready = new Promise<void>((r) => (readyCallback = r));
    let releaseCallback = () => {};
    const wait = new Promise<void>((r) => (releaseCallback = r));

    const movePromise = moveOrgUnit(
      barrierDb(() => readyCallback(), wait),
      {
        id: warehouse.id,
        newParentId: office.id,
        confirmedCalendarSignature: preview.signature,
      },
      admin.id,
    );

    await ready;

    // Calendar write arriving after admin confirmed, before move completes.
    let calendarFinished = false;
    const calendarWrite = saveUnitWorkCalendar(testDb, office.id, {
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 10 * 60,
      workEndMinute: 19 * 60,
      worksOnHolidays: false,
    }).then(() => {
      calendarFinished = true;
    });

    await new Promise((r) => setTimeout(r, 200));

    // Without shared lock, write would have completed and move finalized with 10:00 instead of 09:00.
    expect(calendarFinished).toBe(false);

    releaseCallback();
    const result = await movePromise;
    await calendarWrite;

    expect(result.ok).toBe(true);
    expect(calendarFinished).toBe(true);
  });
});

describe("all work window writers participate in shared lock", () => {
  function pidTrackingDb(onPidReady: (pid: number) => void) {
    return {
      ...testDb,
      $transaction: ((fn: (tx: unknown) => Promise<unknown>) =>
        testDb.$transaction(async (tx) => {
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid()::int AS pid
          `;
          if (!row) throw new Error("Could not read writer connection PID.");
          onPidReady(row.pid);
          return fn(tx);
        })) as typeof testDb.$transaction,
    } as unknown as typeof testDb;
  }

  async function verifyAdvisoryWait(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await testDb.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT ("wait_event_type" = 'Lock' AND "wait_event" = 'advisory') AS waiting
        FROM pg_stat_activity
        WHERE pid = ${pid}
      `;
      if (row?.waiting) return;
      await new Promise((r) => setTimeout(r, 10));
    }

    throw new Error(`PID ${pid} did not wait on advisory lock.`);
  }

  it.each(["company calendar", "unit calendar", "remove unit calendar definition"] as const)(
    "%s writer enters advisory wait while lock is held",
    async (path) => {
      const unit = await createOrgUnit({ name: `Lock ${path}` });
      if (path === "remove unit calendar definition") {
        await saveUnitWorkCalendar(testDb, unit.id, {
          workingDays: [1, 2, 3, 4, 5],
          workStartMinute: 8 * 60,
          workEndMinute: 17 * 60,
          worksOnHolidays: false,
        });
      }

      let lockReadyCallback = () => {};
      const lockReady = new Promise<void>((r) => (lockReadyCallback = r));
      let releaseLockCallback = () => {};
      const release = new Promise<void>((r) => (releaseLockCallback = r));

      const lockHolder = testDb.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${WORK_WINDOW_LOCK_KEY}))
        `;
        lockReadyCallback();
        await release;
      });
      await lockReady;

      let pidReadyCallback!: (pid: number) => void;
      const pidReady = new Promise<number>((r) => (pidReadyCallback = r));
      const db = pidTrackingDb(pidReadyCallback);

      const writer =
        path === "company calendar"
          ? saveWorkCalendar(db, {
              ...DEFAULT_WORK_CALENDAR,
              workStartMinute: 9 * 60,
              workEndMinute: 18 * 60,
            })
          : path === "unit calendar"
            ? saveUnitWorkCalendar(db, unit.id, {
                workingDays: [1, 2, 3, 4, 5],
                workStartMinute: 9 * 60,
                workEndMinute: 18 * 60,
                worksOnHolidays: false,
              })
            : clearUnitWorkCalendar(db, unit.id);

      try {
        const pid = await pidReady;
        await verifyAdvisoryWait(pid);
      } finally {
        releaseLockCallback();
        await lockHolder;
        await writer;
      }
    },
  );
});
