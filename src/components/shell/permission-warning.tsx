import type { CurrentUser } from "@/server/auth/current-user";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
import { getTranslations } from "@/server/i18n/server";

import { AppShell } from "./app-shell";
import { toShellUser } from "./shell-user";

// Keep unauthorized responses inside the application shell so navigation remains
// available without revealing which record or permission check failed.

export interface PermissionWarningProps {
  user: CurrentUser;
  message?: string;
}

export async function PermissionWarning({
  user,
  message,
}: PermissionWarningProps) {
  const t = await getTranslations();
  const displayMessage = message ?? t("screens.users.permission");
  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <Card>
          <EmptyState
            title={t("common.accessDenied")}
            description={displayMessage}
            action={
              <ButtonLink href="/" variant="primary" size="sm">
                {t("common.returnToDashboard")}
              </ButtonLink>
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
