// Form durumu ayrı dosyada: `"use server"` işaretli bir modül yalnız async
// fonksiyon dışa aktarabilir.

export interface AbsenceFormState {
  error: string | null;
  success: string | null;
}

export const emptyAbsenceFormState: AbsenceFormState = {
  error: null,
  success: null,
};
