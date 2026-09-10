// Form durumu ayrı dosyada: `"use server"` işaretli bir modül **yalnız async
// fonksiyon** dışa aktarabilir. Sabit bir nesneyi oradan dışa aktarmak sunucu
// eylemini 500 ile düşürüyordu (19.08.2026'da yakalandı).

export interface NotificationModeState {
  error: string | null;
  success: string | null;
}

export const emptyNotificationModeState: NotificationModeState = {
  error: null,
  success: null,
};

export interface AvatarFormState {
  error: string | null;
  success: string | null;
  /**
   * İşlemden sonraki uzantı; kaldırmada `null`.
   *
   * Ekran bunu kendi durumunda tutuyor. `revalidatePath` "stale-while-
   * revalidate" çalışıyor (Next belgesi, 09-revalidating): kullanıcı kendi
   * yazdığını hemen görmüyor, resim eski kalıyordu.
   */
  extension?: string | null;
  /**
   * İşlem damgası. Resmin adresi değişmiyor (aynı kişi, aynı uzantı); ekran
   * bunu adrese ekleyerek tarayıcının elindeki kopyayı bırakmasını sağlıyor.
   */
  stamp?: number;
}

export const emptyAvatarState: AvatarFormState = { error: null, success: null };
