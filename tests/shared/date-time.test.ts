import { describe, expect, it } from "vitest";

import {
  companyHour,
  companyMinuteOfDay,
  formatDay,
  formatDayLong,
  formatDayShort,
  formatInstant,
  formatInstantPrecise,
  formatInstantShort,
  formatRelativeDay,
  formatTime,
  formatWeekday,
} from "@/shared/format/date-time";

// Tarih biçimlendirmenin tek kaynağı (Görev 11.1).
//
// Modülün varlık sebebi tekrarı azaltmak değil, **zaman dilimi ayrımını tek
// yerde kilitlemek.** Bugün 15 dosyada elle kuruluyor ve ayrım her seferinde
// yeniden yapılıyor:
//
//   - `date` kolonları (faaliyet tarihi, izin aralığı, tatil) zaman dilimi
//     **taşımaz**; her zaman `T00:00:00.000Z` olarak okunur ve UTC ile
//     biçimlenir. İstanbul ile biçimlenirse gece yarısı öncesi değerler bir
//     gün geriye kayar.
//   - `timestamptz` kolonları (oluşturma, düzeltme, denetim izi) gerçek bir
//     andır ve **şirket saatiyle** (Europe/Istanbul) gösterilir.
//
// Aşağıdaki testler bu ayrımın bozulduğunu yakalar.

/** Bir `date` kolonundan okunan gün değeri. */
const gunDegeri = (gun: string) => new Date(`${gun}T00:00:00.000Z`);

describe("formatDay — gün alanları", () => {
  it("günü gün.ay.yıl olarak yazar", () => {
    expect(formatDay(gunDegeri("2026-08-21"))).toBe("21.08.2026");
  });

  it("tek haneli gün ve ayı sıfırla doldurur", () => {
    expect(formatDay(gunDegeri("2026-01-05"))).toBe("05.01.2026");
  });

  // Kritik: gün alanı UTC ile biçimlenmezse İstanbul'un +03 farkı yüzünden
  // gün kayar. Yıl başı bu kaymayı en görünür yapan tarihtir.
  it("yıl başındaki günü bir gün geriye kaydırmaz", () => {
    expect(formatDay(gunDegeri("2026-01-01"))).toBe("01.01.2026");
  });
});

describe("formatDayLong — gün şeridi başlığı", () => {
  it("gün, ay adı, yıl ve hafta gününü yazar", () => {
    expect(formatDayLong(gunDegeri("2026-08-21"))).toBe("21 Ağustos 2026 Cuma");
  });
});

describe("formatDayShort — dar listeler", () => {
  it("günü ve kısa ay adını yazar", () => {
    expect(formatDayShort(gunDegeri("2026-08-21"))).toBe("21 Ağu");
  });
});

describe("formatInstant — an alanları", () => {
  it("anı şirket saatiyle tarih ve saat olarak yazar", () => {
    // 11:32 UTC = 14:32 İstanbul (+03).
    expect(formatInstant(new Date("2026-08-21T11:32:00.000Z"))).toBe(
      "21.08.2026 14:32",
    );
  });

  // Bu testin yakaladığı hata gerçek: UTC ile biçimlenen bir `timestamptz`,
  // gece yarısından önceki üç saatte hem günü hem saati yanlış gösterir.
  it("gece yarısını geçen anı ertesi güne taşır", () => {
    // 21:30 UTC = ertesi gün 00:30 İstanbul.
    expect(formatInstant(new Date("2026-08-21T21:30:00.000Z"))).toBe(
      "22.08.2026 00:30",
    );
  });
});

describe("formatTime — yalnız saat", () => {
  it("saati şirket saatiyle yazar", () => {
    expect(formatTime(new Date("2026-08-21T11:32:00.000Z"))).toBe("14:32");
  });

  it("saati 24 saat düzeninde yazar", () => {
    // 20:05 İstanbul; 12 saatlik düzende "08:05" olurdu.
    expect(formatTime(new Date("2026-08-21T17:05:00.000Z"))).toBe("20:05");
  });
});

describe("formatRelativeDay — liste başlıkları", () => {
  // "Bugün" şirket saatiyle hesaplanır: sunucu UTC'de çalışsa da kullanıcının
  // bugünü İstanbul'daki bugündür.
  const simdi = new Date("2026-08-21T09:00:00.000Z"); // 12:00 İstanbul

  it("bugünü Bugün diye yazar", () => {
    expect(formatRelativeDay(gunDegeri("2026-08-21"), simdi)).toBe("Bugün");
  });

  it("dünü Dün diye yazar", () => {
    expect(formatRelativeDay(gunDegeri("2026-08-20"), simdi)).toBe("Dün");
  });

  it("daha eski günü tarihiyle yazar", () => {
    expect(formatRelativeDay(gunDegeri("2026-08-19"), simdi)).toBe("19.08.2026");
  });

  // Gece yarısından sonraki ilk saatlerde sunucunun UTC günü hâlâ dünü
  // gösterir; "Bugün" kullanıcının gününü izlemelidir.
  it("İstanbul'da gün dönmüşken bugünü doğru bulur", () => {
    const geceYarisiSonrasi = new Date("2026-08-21T21:30:00.000Z"); // 22 Ağu 00:30
    expect(formatRelativeDay(gunDegeri("2026-08-22"), geceYarisiSonrasi)).toBe(
      "Bugün",
    );
  });
});

describe("formatInstantShort — dar yerlerdeki an", () => {
  it("kısa ay adıyla tarih ve saat yazar", () => {
    expect(formatInstantShort(new Date("2026-08-21T11:32:00.000Z"))).toBe(
      "21 Ağu 14:32",
    );
  });

  // Kısa biçim de bir **an**dır: gün alanı gibi UTC ile biçimlenirse gece
  // yarısını geçen kayıtlar bir gün geride görünür.
  it("gece yarısını geçen anı ertesi güne taşır", () => {
    expect(formatInstantShort(new Date("2026-08-21T21:30:00.000Z"))).toBe(
      "22 Ağu 00:30",
    );
  });
});

describe("formatInstantPrecise — denetim izi", () => {
  // Denetim izinde saniye anlamlıdır: aynı dakika içinde birden çok işlem
  // olabilir ve sıraları sorulabilir.
  it("saniyeyi de yazar", () => {
    expect(formatInstantPrecise(new Date("2026-08-21T11:32:07.000Z"))).toBe(
      "21.08.2026 14:32:07",
    );
  });
});

describe("companyHour — şirket saatindeki saat", () => {
  it("şirket saatine göre saati verir", () => {
    expect(companyHour(new Date("2026-08-21T11:32:00.000Z"))).toBe(14);
  });

  it("gece yarısından sonraki saati sıfır olarak verir", () => {
    expect(companyHour(new Date("2026-08-21T21:30:00.000Z"))).toBe(0);
  });

  // 09:00 gibi başında sıfır olan saatler metinden sayıya çevrilirken
  // sekizlik taban gibi yorumlanmamalı.
  it("başında sıfır olan saati doğru okur", () => {
    expect(companyHour(new Date("2026-08-21T06:15:00.000Z"))).toBe(9);
  });
});

describe("formatWeekday — hafta günü", () => {
  it("gün alanının hafta gününü yazar", () => {
    expect(formatWeekday(gunDegeri("2026-08-21"))).toBe("Cuma");
  });

  it("pazarı doğru adlandırır", () => {
    expect(formatWeekday(gunDegeri("2026-08-23"))).toBe("Pazar");
  });
});

describe("companyMinuteOfDay — gün başından itibaren dakika", () => {
  it("şirket saatine göre dakikayı verir", () => {
    // 11:32 UTC = 14:32 İstanbul = 872. dakika.
    expect(companyMinuteOfDay(new Date("2026-08-21T11:32:00.000Z"))).toBe(872);
  });

  it("gece yarısını sıfır kabul eder", () => {
    expect(companyMinuteOfDay(new Date("2026-08-21T21:00:00.000Z"))).toBe(0);
  });
});
