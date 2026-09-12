



export interface WorkWindowSummary {
  days: string;
  hours: string;
  holidays: string;
  source: string;
}

export interface OrgFormState {
  error: string | null;
  success: string | null;

  calendarConfirm?: {
    unitId: string;
    newParentId: string;
    signature: string;
    before: WorkWindowSummary;
    after: WorkWindowSummary;
  };
}

export const emptyOrgFormState: OrgFormState = { error: null, success: null };
