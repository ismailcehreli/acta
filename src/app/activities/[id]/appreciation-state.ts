// Form durumu ayrı dosyada: `"use server"` işaretli bir modül **yalnız async
// fonksiyon** dışa aktarabilir. Sabit bir nesneyi oradan dışa aktarmak bütün
// dosyayı düşürüyor ve faaliyet detay sayfası hiç açılmıyordu — aynı hata
// 19.08.2026'da bildirim tercihinde de yakalanmıştı.

export interface AppreciationState {
  error: string | null;
}

export const emptyAppreciationState: AppreciationState = { error: null };
