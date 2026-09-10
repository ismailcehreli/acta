import { describe, expect, it } from "vitest";

import { describeActivityDates } from "@/shared/format/activity-dates";

// Faaliyetin iki tarihi (Görev 11.1).
//
// `activityDate` faaliyetin **ait olduğu gün**dür ve saati yoktur — bir günün
// saati olmaz. `createdAt` kaydın **yazıldığı an**dır. Geçmişe dönük giriş
// açık olduğu için ikisi ayrışabilir: 19 Ağustos tarihli bir kayıt 21
// Ağustos'ta yazılmış olabilir ve okuyan bunu görebilmelidir.

const gun = (g: string) => new Date(`${g}T00:00:00.000Z`);

describe("iki tarih ayrışırsa", () => {
  it("kaydın yazıldığı anı tam tarihiyle gösterir", () => {
    const sonuc = describeActivityDates({
      activityDate: gun("2026-08-19"),
      createdAt: new Date("2026-08-21T11:32:00.000Z"),
      updatedAt: new Date("2026-08-21T11:32:00.000Z"),
      revisionNo: 1,
    });

    expect(sonuc.main).toBe("19.08.2026");
    expect(sonuc.created).toBe("Kaydedildi: 21.08.2026 14:32");
  });
});

describe("iki tarih aynı güne düşerse", () => {
  // Aynı tarihi iki kez yazmak gürültüdür; saat yeter.
  it("yalnız saati gösterir", () => {
    const sonuc = describeActivityDates({
      activityDate: gun("2026-08-21"),
      createdAt: new Date("2026-08-21T11:32:00.000Z"),
      updatedAt: new Date("2026-08-21T11:32:00.000Z"),
      revisionNo: 1,
    });

    expect(sonuc.main).toBe("21.08.2026");
    expect(sonuc.created).toBe("Kaydedildi: 14:32");
  });

  // "Aynı gün" şirket saatiyle sorulur. 21:30 UTC, İstanbul'da ertesi gündür:
  // 21 Ağustos tarihli bir kayıt aslında 22 Ağustos'ta yazılmıştır.
  it("gece yarısını geçen kaydı ayrı gün sayar", () => {
    const sonuc = describeActivityDates({
      activityDate: gun("2026-08-21"),
      createdAt: new Date("2026-08-21T21:30:00.000Z"),
      updatedAt: new Date("2026-08-21T21:30:00.000Z"),
      revisionNo: 1,
    });

    expect(sonuc.created).toBe("Kaydedildi: 22.08.2026 00:30");
  });
});

describe("düzeltme", () => {
  it("ilk kayıtta düzeltme satırı yoktur", () => {
    const sonuc = describeActivityDates({
      activityDate: gun("2026-08-21"),
      createdAt: new Date("2026-08-21T11:32:00.000Z"),
      updatedAt: new Date("2026-08-21T11:32:00.000Z"),
      revisionNo: 1,
    });

    expect(sonuc.revised).toBeNull();
  });

  it("düzeltilmiş kayıtta anı ve revizyon numarasını gösterir", () => {
    const sonuc = describeActivityDates({
      activityDate: gun("2026-08-21"),
      createdAt: new Date("2026-08-21T11:32:00.000Z"),
      updatedAt: new Date("2026-08-21T13:10:00.000Z"),
      revisionNo: 2,
    });

    expect(sonuc.revised).toBe("Son düzeltme: 21.08.2026 16:10 (rev. 2)");
  });
});
