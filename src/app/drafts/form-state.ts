// Taslak eylemlerinin form durumu.
//
// **Ayrı dosyada, çünkü `"use server"` dosyası yalnız `async` fonksiyon dışa
// aktarabilir.** Sabiti eylemlerin yanına koymak derleme hatası vermiyor,
// çalışma zamanında 500 üretiyor — 19.08.2026'da bir kez yaşandı, aynı tuzağa
// ikinci kez düşmemek için buraya not düşüldü.

export type DraftActionState = {
  error: string | null;
  success: string | null;
  /** Yeni açılan taslağın kimliği; form bir sonraki kaydetmede bunu taşır. */
  draftId?: string;
};

export const emptyDraftState: DraftActionState = { error: null, success: null };
