import type { DeactivationBlockers } from "@/server/users/deactivate";




export interface UserFormState {
  error: string | null;
  success: string | null;

  blockers: DeactivationBlockers | null;
}

export const emptyUserFormState: UserFormState = {
  error: null,
  success: null,
  blockers: null,
};
