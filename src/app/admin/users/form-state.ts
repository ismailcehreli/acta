import type { DeactivationBlockers } from "@/server/users/deactivate";

// "use server" dosyaları yalnızca async fonksiyon dışa aktarabildiği için
// durum tanımları ayrı dosyada durur.

export interface UserFormState {
  error: string | null;
  success: string | null;
  /** Pasifleştirme engellendiyse sistem yöneticisine gösterilecek liste (§4.6). */
  blockers: DeactivationBlockers | null;
}

export const emptyUserFormState: UserFormState = {
  error: null,
  success: null,
  blockers: null,
};
