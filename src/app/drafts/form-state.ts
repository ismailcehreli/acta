// Form state for draft actions.
//





export type DraftActionState = {
  error: string | null;
  success: string | null;

  draftId?: string;
};

export const emptyDraftState: DraftActionState = { error: null, success: null };
