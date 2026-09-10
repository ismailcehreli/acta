export interface BackupFormState {
  error: string | null;
  success: string | null;
}

export const emptyBackupFormState: BackupFormState = {
  error: null,
  success: null,
};
