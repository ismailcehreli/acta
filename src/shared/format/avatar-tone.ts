// Initials-badge color (Task 11.5).
//
// Color is **derived from identity and stable**: the same person must have the
// same color everywhere, or color cannot serve as a visual cue. Random or
// order-based colors would show the same person differently in a list and
// profile.
//
// Each palette tone provides at least 4.5:1 contrast with light text on a dark
// background (WCAG AA). The palette is intentionally small: six colors remain
// distinguishable while twelve begin to blur together.

export const AVATAR_TONE_COUNT = 6;

/**
 * Returns a stable tone number derived from identity (0–5).
 *
 * A simple additive hash is enough: this needs **stability**, not security, and
 * UUID identities already distribute well.
 */
export function avatarToneIndex(id: string): number {
  let total = 0;
  for (let i = 0; i < id.length; i += 1) {
    total = (total + id.charCodeAt(i)) % (AVATAR_TONE_COUNT * 997);
  }

  return total % AVATAR_TONE_COUNT;
}
