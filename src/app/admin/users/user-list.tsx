import Link from "next/link";

import type { ManagedUser } from "@/server/users/list";
import { formatInstantShort } from "@/shared/format/date-time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

// Kullanıcı listesi yalnızca keşif ve yönlendirme ekranıdır. Düzenleme,
// parola ve aktiflik işlemleri tek kullanıcı detayına taşınır; böylece bir
// satır açıldığında bütün tablo aşağı doğru büyümez.

function roleBadges(user: ManagedUser) {
  const roller = [
    user.isRoot ? "ana sistem yöneticisi" : null,
    user.isUnitManager ? "birim yöneticisi" : null,
    user.isSystemAdmin && !user.isRoot ? "sistem yöneticisi" : null,
    !user.writesActivities ? "faaliyet yazmaz" : null,
  ].filter(Boolean) as string[];

  if (roller.length === 0) {
    return <span className="text-muted">—</span>;
  }

  return (
    <span className="flex flex-wrap gap-1">
      {roller.map((rol) => (
        <Badge
          key={rol}
          tone={
            rol === "ana sistem yöneticisi" || rol === "sistem yöneticisi"
              ? "primary"
              : "neutral"
          }
        >
          {rol}
        </Badge>
      ))}
    </span>
  );
}

function UserRow({ user, returnTo }: { user: ManagedUser; returnTo: string }) {
  const detailHref = `/admin/users/${user.id}?${new URLSearchParams({ donus: returnTo }).toString()}`;

  return (
    <TR data-test="kullanici-satiri">
      <TD>
        <Link href={detailHref} className="group flex items-center gap-2">
          <Avatar user={user} size={32} />
          <span className="min-w-0">
            <span className="block font-medium text-ink group-hover:text-primary group-hover:underline">
              {user.fullName}
            </span>
            {user.title ? (
              <span className="block text-xs text-ink">{user.title}</span>
            ) : null}
            <span className="block text-xs text-muted">{user.email}</span>
          </span>
        </Link>
      </TD>
      <TD>{user.orgUnitName}</TD>
      <TD>{roleBadges(user)}</TD>
      <TD>
        <span
          className="flex flex-col gap-1"
          data-durum={user.isActive ? "aktif" : "pasif"}
        >
          {user.isActive ? (
            <Badge tone="success">aktif</Badge>
          ) : (
            <Badge tone="neutral">pasif</Badge>
          )}
          <span className="text-xs text-muted">
            {user.lastLoginAt
              ? `Son giriş ${formatInstantShort(user.lastLoginAt)}`
              : "Henüz giriş yapmadı"}
          </span>
        </span>
      </TD>
      <TD align="right">
        <ButtonLink href={detailHref} size="sm">
          Detayı aç
        </ButtonLink>
      </TD>
    </TR>
  );
}

export function UserList({
  users,
  returnTo = "/admin/users",
}: {
  users: ManagedUser[];
  /** Liste filtrelerini detaydan geri dönerken korumak için. */
  returnTo?: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Kullanıcı listesi"
        description="Bir hesabın ayarlarını değiştirmek için satırdaki detayı açın."
      />

      {users.length === 0 ? (
        <EmptyState title="Bu ölçütlere uyan kullanıcı yok." />
      ) : (
        <CardBody className="p-0">
          <Table label="Kullanıcı listesi tablosu">
            <THead>
              <TR>
                <TH>Kullanıcı</TH>
                <TH>Birim</TH>
                <TH>Roller</TH>
                <TH>Durum / son giriş</TH>
                <TH align="right">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} returnTo={returnTo} />
              ))}
            </TBody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}
