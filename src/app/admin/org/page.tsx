import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";

import type { UnitOption } from "./org-form";
import { OrgTree } from "./org-tree";

export const metadata = { title: "Organizasyon ağacı — Yönetim" };

/** Seçim listeleri için ağacı düz listeye açar; girinti kademeyi gösterir. */
function toOptions(nodes: OrgUnitNode[], depth = 0): UnitOption[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toOptions(node.children, depth + 1),
  ]);
}

export default async function OrgAdminPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  // Ekranın gizlenmesi tek başına koruma değildir; sunucu eylemleri de aynı
  // kontrolü kendi başına yapar (bkz. actions.ts).
  if (!canManageOrganization(user)) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Organizasyon yönetimi yalnızca sistem yöneticisine açıktır."
      />
    );
  }

  const roots = await loadOrgTree(prisma);
  const options = toOptions(roots);

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page>
        <PageHeader
          title="Organizasyon ağacı"
          description="Şirketin birim ağacı: kimin kime bağlı olduğu, dolayısıyla kimin kimin kaydını göreceği ve onaylayacağı buradan belirlenir. Birimler silinmez, ihtiyaç kalmadığında pasifleştirilir — böylece o birime yazılmış geçmiş kayıtlar bozulmaz."
          breadcrumbs={[{ label: "Yönetim" }, { label: "Organizasyon" }]}
          action={
            <ButtonLink href="/admin/org/new" variant="primary">
              Yeni birim
            </ButtonLink>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <Card>
          <CardHeader title="Mevcut ağaç" />
          <CardBody>
            <OrgTree roots={roots} options={options} />
          </CardBody>
        </Card>

      </Page>
    </AppShell>
  );
}
