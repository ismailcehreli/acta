import {
  companyDay,
  formatDay,
  formatInstant,
  formatTime,
} from "./date-time";

// Faaliyetin **iki tarihi** (Görev 11.1).
//
// `activityDate` faaliyetin ait olduğu gündür ve saati yoktur — bir günün
// saati olmaz. `createdAt` kaydın yazıldığı andır. Geçmişe dönük giriş açık
// olduğu için (`retroactive_entry_days`) ikisi ayrışabilir: 19 Ağustos
// tarihli bir kayıt 21 Ağustos'ta yazılmış olabilir. Okuyanın bunu görmesi
// gerekir; aksi hâlde "bu iş ne zaman yapıldı" ile "bu kayıt ne zaman
// tutuldu" soruları birbirine karışır.
//
// Mantık burada, bileşende değil: hangi durumda ne yazıldığı sınanabilir
// olmalı ve aynı kural liste, detay ve arama ekranlarında aynı çalışmalı.

export interface ActivityDateInput {
  /** Faaliyetin ait olduğu gün (`date` kolonu). */
  activityDate: Date;
  /** Kaydın yazıldığı an (`timestamptz`). */
  createdAt: Date;
  /** Son değişiklik anı (`timestamptz`). */
  updatedAt: Date;
  /** Son revizyonun numarası; ilk kayıt 1'dir. */
  revisionNo: number;
}

export interface ActivityDates {
  /** Ana tarih: faaliyetin günü. */
  main: string;
  /** "Kaydedildi: …" satırı. */
  created: string;
  /** "Son düzeltme: …" satırı; düzeltilmemiş kayıtta boş. */
  revised: string | null;
}

export function describeActivityDates(input: ActivityDateInput): ActivityDates {
  // "Aynı gün mü" sorusu **şirket saatiyle** sorulur: 21 Ağustos tarihli bir
  // kayıt İstanbul'da 22 Ağustos 00:30'da yazılmış olabilir ve o zaman iki
  // tarih gerçekten ayrıdır.
  const yazimGunu = companyDay(input.createdAt);
  const faaliyetGunu = input.activityDate.toISOString().slice(0, 10);

  const created =
    yazimGunu === faaliyetGunu
      ? `Kaydedildi: ${formatTime(input.createdAt)}`
      : `Kaydedildi: ${formatInstant(input.createdAt)}`;

  const revised =
    input.revisionNo > 1
      ? `Son düzeltme: ${formatInstant(input.updatedAt)} (rev. ${input.revisionNo})`
      : null;

  return { main: formatDay(input.activityDate), created, revised };
}
