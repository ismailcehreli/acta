// Tarih ve saat biçimlendirmenin **tek kaynağı**.
//
// Bu modül tekrarı azaltmak için değil, **zaman dilimi ayrımını tek yerde
// kilitlemek** için var. Ayrım şu ve her çağrıda yeniden yapılırsa er geç
// biri yanlış yapar:
//
//   - `date` kolonları — faaliyet tarihi, izin aralığı, tatil — zaman dilimi
//     **taşımaz.** Veritabanından her zaman `T00:00:00.000Z` olarak okunur ve
//     **UTC** ile biçimlenir. Şirket saatiyle biçimlenirse +03 farkı yüzünden
//     gün bir geriye kayar.
//   - `timestamptz` kolonları — oluşturma, düzeltme, denetim izi — gerçek bir
//     andır ve **şirket saatiyle** (Europe/Istanbul) gösterilir. UTC ile
//     biçimlenirse gece yarısından önceki üç saatte hem gün hem saat yanlış
//     çıkar.
//
// Fonksiyon adları bu ayrımı taşır: `…Day` gün alanları içindir, `…Instant`
// ve `…Time` an alanları için.

export const COMPANY_TIME_ZONE = "Europe/Istanbul";

// Biçimlendiriciler modül düzeyinde bir kez kurulur: `Intl.DateTimeFormat`
// kurulumu pahalıdır ve bu fonksiyonlar liste satırı başına çağrılır.

const dayFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dayLongFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
});

const dayShortFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const instantDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: COMPANY_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: COMPANY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const instantShortDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: COMPANY_TIME_ZONE,
  day: "numeric",
  month: "short",
});

const secondFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: COMPANY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: COMPANY_TIME_ZONE,
  hour: "2-digit",
  hour12: false,
});

const weekdayFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "UTC",
  weekday: "long",
});

/** Şirket saatindeki günü `YYYY-MM-DD` olarak verir (§16.6). */
const companyDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Verilen ana karşılık gelen **şirket günü** (`YYYY-MM-DD`).
 *
 * Sunucu UTC'de çalışsa da "bugün" İstanbul'daki bugündür. Gün sınırına yakın
 * saatlerde ikisi ayrışır ve kullanıcının gördüğü gün burada belirlenir.
 */
export function companyDay(instant: Date): string {
  return companyDayFormatter.format(instant);
}

const companyPartFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COMPANY_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Verilen anda şirket saatinin UTC'ye göre kayması (milisaniye). */
function companyOffsetMs(instant: Date): number {
  const parcalar = companyPartFormatter.formatToParts(instant);
  const al = (tur: string): number =>
    Number(parcalar.find((parca) => parca.type === tur)?.value ?? "0");

  const yerelUtc = Date.UTC(
    al("year"),
    al("month") - 1,
    al("day"),
    al("hour") % 24,
    al("minute"),
    al("second"),
  );

  return yerelUtc - instant.getTime();
}

/**
 * Şirket gününün **başladığı an**.
 *
 * Gün alanları (`@db.Date`) ile zaman damgaları aynı sınırla
 * karşılaştırılamaz: "31 Ağustos" bir gün alanı için kapsayıcı üst sınırdır,
 * ama bir zaman damgası için o günün **00:00**'ıdır ve gün içinde olan her
 * şeyi dışarıda bırakır (denetim 23.08.2026, P3-3). Zaman damgalı
 * aralıklar bu yüzden `[günBaşı, sonrakiGünBaşı)` biçiminde kuruluyor ve
 * sınır şirket saatiyle hesaplanıyor — sunucu UTC'de koşsa da gün İstanbul'da
 * başlar.
 */
export function companyDayStart(day: string): Date {
  const utcGeceYarisi = new Date(`${day}T00:00:00.000Z`);
  const kayma = companyOffsetMs(utcGeceYarisi);
  const ilk = new Date(utcGeceYarisi.getTime() - kayma);

  // Yaz saati sınırında kayma değişebilir; bir kez daha düzeltilir.
  const ikinciKayma = companyOffsetMs(ilk);
  return ikinciKayma === kayma
    ? ilk
    : new Date(utcGeceYarisi.getTime() - ikinciKayma);
}

/** Verilen şirket gününü izleyen günün başladığı an. */
export function nextCompanyDayStart(day: string): Date {
  const sonraki = new Date(`${day}T00:00:00.000Z`);
  sonraki.setUTCDate(sonraki.getUTCDate() + 1);

  return companyDayStart(sonraki.toISOString().slice(0, 10));
}

/** `YYYY-MM-DD` metnini bir gün alanına yazılacak değere çevirir. */
export function toDateValue(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Gün alanı → `21.08.2026`. Faaliyet tarihi, izin aralığı, tatil. */
export function formatDay(day: Date): string {
  return dayFormatter.format(day);
}

/** Gün alanı → `21 Ağustos 2026 Cuma`. Gün şeridi başlıkları. */
export function formatDayLong(day: Date): string {
  return dayLongFormatter.format(day);
}

/** Gün alanı → `21 Ağu`. Dar listeler. */
export function formatDayShort(day: Date): string {
  return dayShortFormatter.format(day);
}

/** An alanı → `21.08.2026 14:32`. Oluşturma, düzeltme, denetim izi. */
export function formatInstant(instant: Date): string {
  return `${instantDateFormatter.format(instant)} ${timeFormatter.format(instant)}`;
}

/** An alanı → `14:32`. Aynı gün içindeki an. */
export function formatTime(instant: Date): string {
  return timeFormatter.format(instant);
}

/**
 * Gün alanı → `Bugün` / `Dün` / `19.08.2026`.
 *
 * "Bugün" **şirket saatiyle** hesaplanır. Sunucunun UTC günüyle karşılaştırmak,
 * gece yarısından sonraki ilk üç saatte listeye "Dün" yazdırırdı.
 */
export function formatRelativeDay(day: Date, now: Date): string {
  const gun = day.toISOString().slice(0, 10);
  const bugun = companyDay(now);

  if (gun === bugun) return "Bugün";

  const dun = companyDay(new Date(toDateValue(bugun).getTime() - 86_400_000));
  if (gun === dun) return "Dün";

  return formatDay(day);
}

/**
 * An alanı → `21 Ağu 14:32`. Dar yerlerde (taslak listesi, vekâlet kararları).
 *
 * `formatDayShort` ile karıştırılmamalı: o bir **gün alanı** içindir ve UTC
 * kullanır. Bu bir andır ve şirket saatiyle gösterilir.
 */
export function formatInstantShort(instant: Date): string {
  return `${instantShortDateFormatter.format(instant)} ${timeFormatter.format(instant)}`;
}

/**
 * An alanı → `21.08.2026 14:32:07`. Yalnız denetim izi.
 *
 * Saniye başka hiçbir ekranda gösterilmez; orada gürültüdür. Denetim izinde
 * ise anlamlıdır: aynı dakika içinde birden çok işlem olabilir ve sıraları
 * sorulabilir.
 */
export function formatInstantPrecise(instant: Date): string {
  return `${instantDateFormatter.format(instant)} ${secondFormatter.format(instant)}`;
}

/**
 * Şirket saatindeki saat (0–23).
 *
 * `Number()` ile çevriliyor, `parseInt` ile değil: "09" gibi başında sıfır
 * olan değerler `Number` için ondalıktır.
 */
export function companyHour(instant: Date): number {
  return Number(hourFormatter.format(instant));
}

/** Gün alanı → `Cuma`. Grafik ipuçları, gün etiketleri. */
export function formatWeekday(day: Date): string {
  return weekdayFormatter.format(day);
}

/**
 * Şirket saatinde gün başından itibaren geçen dakika (0–1439).
 *
 * Mesai penceresi hesapları bu ölçüyü kullanır: `08:30` → `510`.
 */
export function companyMinuteOfDay(instant: Date): number {
  const [saat, dakika] = timeFormatter.format(instant).split(":");
  return Number(saat) * 60 + Number(dakika);
}
