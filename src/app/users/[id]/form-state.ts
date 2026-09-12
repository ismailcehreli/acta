



export interface NotificationModeState {
  error: string | null;
  success: string | null;
}

export const emptyNotificationModeState: NotificationModeState = {
  error: null,
  success: null,
};

export interface AvatarFormState {
  error: string | null;
  success: string | null;

  extension?: string | null;

  stamp?: number;
}

export const emptyAvatarState: AvatarFormState = { error: null, success: null };
