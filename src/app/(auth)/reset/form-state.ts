export interface ResetFormState {
  error: string | null;
  /** İstek alındı bilgisi; kullanıcının kayıtlı olup olmadığını **ele vermez**. */
  info: string | null;
}

export const emptyResetFormState: ResetFormState = { error: null, info: null };
