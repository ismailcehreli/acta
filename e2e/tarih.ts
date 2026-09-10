import { companyDay } from "../src/shared/format/date-time";

// Uçtan uca testlerde gün hesabı.
//
// **Neden ayrı bir dosya:** testler günü `toISOString().slice(0, 10)` ile
// çıkarıyordu; bu **UTC** günüdür, uygulama ise günü şirketin yerel saatine
// göre sayıyor (Europe/Istanbul, §16.6). İkisi gece yarısı ile 03:00 arasında
// ayrışıyor ve "dün" bir gün daha geriye kayıyordu. Sonuç: geçmişe dönük
// giriş penceresi bir günken, test iki gün öncesini gönderip "bu tarih sınırın
// dışında" cevabını alıyordu — ve bu yalnız gece yarısından sonra oluyordu
// (22–23.08.2026 gecesi yakalandı).
//
// Hesap yeniden yazılmıyor, uygulamanın kendi modülünden alınıyor: iki ayrı
// yerde kurulmuş iki biçimlendirici zamanla sessizce ayrışır.

/** Şirket saatine göre bugünün günü (YYYY-AA-GG). */
export function bugun(): string {
  return companyDay(new Date());
}

/** Şirket saatine göre bugünden `gun` kadar uzaktaki gün. */
export function gunEkle(gun: number): string {
  return companyDay(new Date(Date.now() + gun * 86_400_000));
}
