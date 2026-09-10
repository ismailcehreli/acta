export interface HelpFormState {
  error: string | null;
  success: string | null;
}

export const emptyHelpFormState: HelpFormState = {
  error: null,
  success: null,
};
