export interface FeedbackFormState {
  error: string | null;
  success: string | null;
}

export const emptyFeedbackFormState: FeedbackFormState = {
  error: null,
  success: null,
};
