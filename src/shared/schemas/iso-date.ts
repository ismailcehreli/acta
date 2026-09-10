import { z } from "zod";

// Takvim günü (`YYYY-MM-DD`) — **var olan** bir gün olmak zorunda.
//
// Denetim 21.08.2026, bulgu 17: şemalar yalnız biçime bakıyordu.
// `2026-02-31` regexten geçiyor ve `new Date` onu sessizce 3 Mart'a
// yuvarlıyordu; `2026-99-99` ise geçersiz bir tarih olarak veri katmanına
// kadar taşınıyordu. Sunucu istemci kontrolüne güvenemez: elle hazırlanmış
// bir istek bu değerleri doğrudan gönderebilir.
//
// Kontrol, ayrıştırıp **geri yazarak** yapılır: `Date` normalize ettiği için
// tek güvenilir kanıt, çıkanın girenle aynı gün olmasıdır.

const BICIM = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(value: string): boolean {
  if (!BICIM.test(value)) return false;

  const [yil, ay, gun] = value.split("-").map(Number) as [number, number, number];
  if (ay < 1 || ay > 12 || gun < 1 || gun > 31) return false;

  const tarih = new Date(Date.UTC(yil, ay - 1, gun));

  return (
    tarih.getUTCFullYear() === yil &&
    tarih.getUTCMonth() === ay - 1 &&
    tarih.getUTCDate() === gun
  );
}

/** Ortak gün şeması; tarih alanı olan her şema bunu kullanır. */
export function isoDaySchema(mesaj = "Tarih GG.AA.YYYY biçiminde seçilmeli") {
  return z.string().refine(isCalendarDay, mesaj);
}
