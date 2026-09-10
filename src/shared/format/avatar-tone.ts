// Baş harf rozetinin rengi (Görev 11.5).
//
// Renk **kimlikten türetilir ve değişmez**: aynı kişi her ekranda aynı renkte
// görünmeli, yoksa göz rengi bir işaret olarak kullanamaz. Rastgele ya da
// sıraya bağlı renk, aynı kişiyi listede bir türlü, profilde başka türlü
// gösterirdi.
//
// Paletteki her ton koyu zeminde açık metinle en az 4.5:1 kontrast verecek
// şekilde seçildi (WCAG AA); ton sayısı bilerek küçük — altı renk ayırt
// edilebilir, on iki renk birbirine karışır.

export const AVATAR_TONE_COUNT = 6;

/**
 * Kimlikten kararlı bir ton numarası (0–5).
 *
 * Basit bir toplama karması yetiyor: burada güvenlik değil **kararlılık**
 * aranıyor ve kimlikler UUID olduğu için dağılım zaten düzgün.
 */
export function avatarToneIndex(id: string): number {
  let toplam = 0;
  for (let i = 0; i < id.length; i += 1) {
    toplam = (toplam + id.charCodeAt(i)) % (AVATAR_TONE_COUNT * 997);
  }

  return toplam % AVATAR_TONE_COUNT;
}
