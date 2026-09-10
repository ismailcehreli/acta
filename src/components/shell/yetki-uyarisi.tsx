import type { CurrentUser } from "@/server/auth/current-user";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Page } from "@/components/ui/page";

import { AppShell } from "./app-shell";
import { toShellUser } from "./shell-user";

// Yetkisiz erişimde gösterilen ekran. Kabuk içinde kalır: kullanıcı boş bir
// sayfaya düşmez, menüsü elinin altındadır ve geri dönebilir.
//
// Mesaj neyin eksik olduğunu söyler, **hangi kaydın var olduğunu değil**
// (§18.4): "bu faaliyeti göremezsiniz" demek kaydın varlığını doğrulardı.

export async function YetkiUyarisi({
  user,
  mesaj,
}: {
  user: CurrentUser;
  mesaj: string;
}) {
  return (
    <AppShell user={await toShellUser(user)}>
      <Page>
        <Card>
          <EmptyState
            title="Bu sayfayı görüntüleyemezsiniz"
            description={mesaj}
            action={
              <ButtonLink href="/" variant="primary" size="sm">
                Ana ekrana dön
              </ButtonLink>
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
