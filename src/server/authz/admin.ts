import { getCurrentUser, type CurrentUser } from "@/server/auth/current-user";






export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}


export function canManageOrganization(
  user: Pick<CurrentUser, "isSystemAdmin"> | null,
): boolean {
  return user?.isSystemAdmin === true;
}


export async function requireSystemAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!canManageOrganization(user)) {
    throw new AuthorizationError(
      "This operation requires system administrator access.",
    );
  }

  return user as CurrentUser;
}
