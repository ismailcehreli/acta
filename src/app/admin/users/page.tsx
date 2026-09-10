import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { canManageOrganization } from "@/server/authz/admin";
import { manageableUnitIds } from "@/server/authz/unit-admin";
import { prisma } from "@/server/db";
import { loadOrgTree, type OrgUnitNode } from "@/server/org/tree";
import {
  countUsers,
  listUsers,
  type UserListFilters,
} from "@/server/users/list";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { SearchField } from "@/components/filters/activity-filters";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { YetkiUyarisi } from "@/components/shell/yetki-uyarisi";
import { AdminNav } from "@/components/shell/admin-nav";
import { Page, PageHeader } from "@/components/ui/page";

import type { UnitChoice } from "./user-form";
import { UserList } from "./user-list";

export const metadata = { title: "Kullanıcılar" };

/** Aktif birimleri girintili düz listeye açar. */
function toChoices(nodes: OrgUnitNode[], depth = 0): UnitChoice[] {
  return nodes.flatMap((node) => [
    ...(node.isActive
      ? [{ id: node.id, label: `${"— ".repeat(depth)}${node.name}` }]
      : []),
    ...toChoices(node.children, depth + 1),
  ]);
}

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    birim?: string;
    durum?: string;
    rol?: string;
    q?: string;
    sayfa?: string;
    boyut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Ekran artık bölüm yöneticisine de açık (Görev 11.7); kapsamı daralıyor.
  // Yetki kararı ekranın kendisinde durmuyor: her sunucu eylemi hedefi ayrıca
  // `canManageUser` ile sınıyor. Ekranın gizlenmesi güvenlik değildir.
  const yonetilebilirBirimler = await manageableUnitIds(prisma, user.id);
  if (yonetilebilirBirimler.length === 0) {
    return (
      <YetkiUyarisi
        user={user}
        mesaj="Kullanıcı yönetimi sistem yöneticisine ve birim yöneticilerine açıktır."
      />
    );
  }

  const sistemYoneticisi = canManageOrganization(user);

  const params = await searchParams;

  const filters: UserListFilters = {
    // Müdürün göreceği liste kendi ağacıyla sınırlı; süzgeç bunu daraltabilir
    // ama genişletemez.
    orgUnitIds: sistemYoneticisi ? undefined : yonetilebilirBirimler,
    orgUnitId: params.birim || undefined,
    isActive:
      params.durum === "aktif" ? true : params.durum === "pasif" ? false : undefined,
    role:
      params.rol === "mudur"
        ? "unitManager"
        : params.rol === "yonetici"
          ? "systemAdmin"
          : undefined,
    query: params.q || undefined,
  };

  const SAYFA_BOYU = await resolvePageSize(params.boyut);
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  const [toplam, roots] = await Promise.all([
    countUsers(prisma, filters),
    loadOrgTree(prisma),
  ]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYU));
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const users = await listUsers(prisma, filters, {
    limit: SAYFA_BOYU,
    skip: (gecerliSayfa - 1) * SAYFA_BOYU,
  });

  const tumBirimler = toChoices(roots);
  // Birim seçici müdürün ağacıyla sınırlı: başka birime kullanıcı açamaz.
  const units = sistemYoneticisi
    ? tumBirimler
    : tumBirimler.filter((birim) => yonetilebilirBirimler.includes(birim.id));

  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress(
      "/admin/users",
      {
        birim: params.birim,
        durum: params.durum,
        rol: params.rol,
        q: params.q,
        boyut: String(SAYFA_BOYU),
      },
      ek,
    );

  const suzgecliMi =
    Boolean(params.birim) ||
    Boolean(params.durum) ||
    Boolean(params.rol) ||
    Boolean(params.q);

  return (
    <AppShell
      user={await toShellUser(user)}
    >
      <Page isaret="kullanici-yonetimi">
        <PageHeader
          title="Kullanıcılar"
          description="Hesaplar silinmez, pasifleştirilir: pasif kullanıcı giriş yapamaz ama yazdığı geçmiş kayıtlar yerinde kalır."
          breadcrumbs={[{ label: "Yönetim" }, { label: "Kullanıcılar" }]}
          action={
            <ButtonLink href="/admin/users/new" variant="primary">
              Yeni kullanıcı
            </ButtonLink>
          }
        />

        <AdminNav isRoot={user.isRoot} />

        <FilterBar
          action="/admin/users"
          clearHref="/admin/users"
          filtered={suzgecliMi}
          pageSize={SAYFA_BOYU}
          extra={<SearchField value={params.q ?? ""} label="Ad ya da e-posta" />}
          fields={[
            {
              name: "birim",
              label: "Birime göre",
              value: params.birim ?? "",
              width: "w-52",
              options: [
                { value: "", label: "Hepsi" },
                ...units.map((u) => ({ value: u.id, label: u.label })),
              ],
            },
            {
              name: "durum",
              label: "Hesap durumu",
              value: params.durum ?? "",
              width: "w-36",
              options: [
                { value: "", label: "Hepsi" },
                { value: "aktif", label: "Aktif" },
                { value: "pasif", label: "Pasif" },
              ],
            },
            {
              name: "rol",
              label: "Rol",
              value: params.rol ?? "",
              width: "w-44",
              options: [
                { value: "", label: "Hepsi" },
                { value: "mudur", label: "Birim yöneticisi" },
                { value: "yonetici", label: "Sistem yöneticisi" },
              ],
            },
          ]}
        />

        <UserList
          users={users}
          returnTo={adres()}
        />

        <Pagination
          page={gecerliSayfa}
          pageCount={sayfaSayisi}
          hrefFor={(hedef) =>
            hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
          }
          totalLabel={`${toplam} kullanıcı`}
        />
      </Page>
    </AppShell>
  );
}
