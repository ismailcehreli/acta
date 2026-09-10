export interface BulkApprovalFormState {
  error: string | null;
  success: string | null;
}

export const emptyBulkApprovalFormState: BulkApprovalFormState = {
  error: null,
  success: null,
};
