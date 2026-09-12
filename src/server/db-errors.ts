import { Prisma } from "@prisma/client";


//



//








//




/** Extracts readable text from an unknown error. */
function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


export function hasDatabaseSentinel(error: unknown, sentinel: string): boolean {
  return text(error).includes(`${sentinel}:`);
}

/**
 * Is this a unique-constraint violation?
 *
 * Prefer Prisma's **error code** (P2002) over message text. When `field` is
 * provided, also verify that the violation concerns that column.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    // Wrapped errors may hide the code, so use a narrow message pattern as a
    // fallback; this is not the same as searching for a bare word.
    const t = text(error);
    if (!/Unique constraint failed on the fields?: \(/.test(t)) return false;
    return field === undefined || t.includes(field);
  }

  if (error.code !== "P2002") return false;
  if (field === undefined) return true;

  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes(field)
    : String(target ?? "").includes(field);
}

/**
 * Is this a PostgreSQL **exclusion constraint** (EXCLUDE) violation?
 *
 * Constraints such as `NoActivityPeriod_no_overlap` are not triggers: the
 * database creates the message and it does not use the `AD:` format. Searching
 * for a bare name also fails because the name is already present in bundled
 * source (the exact cause of finding 11).
 *
 * Check both SQLSTATE **23P01** (`exclusion_violation`) and the constraint name
 * in its **quoted** database-message form. The `\s*` pattern remains literal
 * in bundled source and does not match itself; this is the same idea as the
 * colon trick in `hasDatabaseSentinel`.
 */
export function isExclusionViolation(error: unknown, constraint: string): boolean {
  const t = text(error);

  if (!/code:\s*"23P01"/.test(t)) return false;

  return t.includes(`exclusion constraint \\"${constraint}\\"`)
    || t.includes(`exclusion constraint "${constraint}"`);
}
