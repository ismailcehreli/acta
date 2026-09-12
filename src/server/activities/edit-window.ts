// Editing window (§5.5).
//




export type EditRefusal = "window_closed" | "already_read" | "not_author";

export interface EditWindowInput {
  createdAt: Date;
  now: Date;
  windowMinutes: number;

  readByOthers: boolean;
}

export function checkEditWindow(input: EditWindowInput): EditRefusal | null {
  if (input.readByOthers) return "already_read";

  const elapsedMs = input.now.getTime() - input.createdAt.getTime();
  if (elapsedMs > input.windowMinutes * 60_000) return "window_closed";

  return null;
}
