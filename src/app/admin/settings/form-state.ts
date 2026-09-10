export interface SettingsFormState {
  error: string | null;
  success: string | null;
}

export const emptySettingsFormState: SettingsFormState = {
  error: null,
  success: null,
};
