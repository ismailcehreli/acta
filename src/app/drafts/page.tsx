import { redirect } from "next/navigation";

import {
  countDrafts,
  listDrafts,
  type DraftFilters,
} from "@/server/activities/drafts";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { RecordItem, RecordList } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { buildQueryAddress } from "@/shared/filters/query-address";
import { resolvePageSize } from "@/server/preferences/page-size";

import { DeleteDraftButton } from "./delete-draft-button";
import { formatDay, formatInstantShort } from "@/shared/format/date-time";

// Taslaklar (ürün sahibi isteği, 21.08.2026).
//
// Gönderilmemiş metinlerin durduğu yer. İki yoldan dolar ve ikisi de aynı
// listede görünür:
//
//   · **Bilerek bekletilen** — kullanıcı "Taslak olarak kaydet" dedi, son bir
//     kontrolden sonra gönderecek.
//   · **Kazara kalan** — sekme kapandı, tarayıcı çöktü, telefon kapandı.
//     Yazarken arka planda kaydedilmişti.
//
// İkisi rozetle ayrılıyor: bilerek bekletilen bir taslakla kazara kalan bir
// müsvedde aynı şey değil ve kullanıcı hangisini eline aldığını bilmeli.
//
// **Taslak kimseye görünmez.** Yöneticisi de, sistem yöneticisi de göremez;
// kayıt gönderilene kadar ortada bir faaliyet yoktur.

export const metadata = { title: "Taslaklar" };

const BILGI: Record<string, string> = {
  taslak: "Taslak kaydedildi. Göndermediğiniz sürece kimse göremez.",
  silindi: "Taslak silindi.",
};

/** Açıklamanın listede görünen ilk satırı. */
function onizleme(text: string): string {
  const tek = text.replace(/\s+/g, " ").trim();
  return tek.length > 160 ? `${tek.slice(0, 160)}…` : tek;
}

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kayit?: string;
    tur?: string;
    sayfa?: string;
    boyut?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const { kayit } = params;

  // Kayıt türü: elle bırakılan mı, kazara kalan mı. Tanınmayan değer süzgeci
  // sessizce düşürür — eski bir bağlantı bozuk sayfa açmasın.
  const filters: DraftFilters =
    params.tur === "elle"
      ? { savedManually: true }
      : params.tur === "otomatik"
        ? { savedManually: false }
        : {};

  const SAYFA_BOYU = await resolvePageSize(params.boyut);
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  const [toplam, shellUser] = await Promise.all([
    countDrafts(prisma, user.id, filters),
    toShellUser(user),
  ]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYU));
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const drafts = await listDrafts(prisma, user.id, filters, {
    limit: SAYFA_BOYU,
    skip: (gecerliSayfa - 1) * SAYFA_BOYU,
  });

  /** Süzgeci koruyan adres; sayfalama ve boy seçimi bunu kullanır. */
  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress("/drafts", { tur: params.tur, boyut: String(SAYFA_BOYU) }, ek);

  const suzgecliMi = Boolean(params.tur);

  return (
    <AppShell user={shellUser}>
      <Page isaret="taslaklar">
        <PageHeader
          marker="Taslaklar"
          title="Taslaklar"
          description="Yazılmış ama gönderilmemiş kayıtlar. Göndermediğiniz sürece kimse göremez."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Taslaklar" }]}
          action={
            <ButtonLink href="/activities/new" variant="primary">
              Yeni faaliyet
            </ButtonLink>
          }
        />

        {kayit ? (
          <div id="taslak-bilgi" role="status">
            <Alert tone="success">{BILGI[kayit] ?? "İşlem tamamlandı."}</Alert>
          </div>
        ) : null}

        <Card>
          <CardHeader
            title="Gönderilmeyi bekleyenler"
            description="Kaldığınız yerden devam etmek için taslağın başlığına tıklayın."
            action={
              <span className="mono text-[length:var(--text-sm)] text-muted">
                {toplam} taslak
              </span>
            }
          />

          <FilterBar
            action="/drafts"
            clearHref="/drafts"
            filtered={suzgecliMi}
            pageSize={SAYFA_BOYU}
            fields={[
              {
                name: "tur",
                label: "Kayıt türü",
                value: params.tur ?? "",
                width: "w-52",
                options: [
                  { value: "", label: "Hepsi" },
                  { value: "elle", label: "Bilerek bırakılan" },
                  { value: "otomatik", label: "Kazara kalan" },
                ],
              },
            ]}
          />

          {drafts.length === 0 ? (
            suzgecliMi ? (
              <EmptyState
                title="Süzgece uyan taslak yok."
                description="Süzgeci temizleyerek bütün taslaklarınızı görebilirsiniz."
                action={
                  <ButtonLink href="/drafts" variant="secondary" size="sm">
                    Süzgeci temizle
                  </ButtonLink>
                }
              />
            ) : (
            <EmptyState
              title="Taslağınız yok."
              description="Bir faaliyet yazarken tamamlayamazsanız metniniz otomatik olarak buraya düşer; dilerseniz “Taslak olarak kaydet” diyerek de bırakabilirsiniz."
              action={
                <ButtonLink href="/activities/new" variant="primary" size="sm">
                  Faaliyet yazmaya başla
                </ButtonLink>
              }
            />
            )
          ) : (
            <RecordList>
              {drafts.map((draft) => (
                <RecordItem
                  key={draft.id}
                  data-test="taslak-satiri"
                  className="transition-colors duration-(--duration-fast) hover:bg-surface-hover sm:px-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span
                          className={
                            draft.title.trim() === ""
                              ? "text-[length:var(--text-base)] font-medium text-faint italic"
                              : "text-[length:var(--text-base)] font-medium text-ink"
                          }
                        >
                          {draft.title.trim() === "" ? "Başlıksız taslak" : draft.title}
                        </span>
                        {draft.savedManually ? (
                          <Badge tone="waiting">Bekletiliyor</Badge>
                        ) : (
                          <Badge tone="neutral">Otomatik kaydedildi</Badge>
                        )}
                      </div>

                      {draft.description.trim() !== "" ? (
                        <p className="prose-measure mt-1 text-[length:var(--text-sm)] text-muted">
                          {onizleme(draft.description)}
                        </p>
                      ) : null}

                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-faint">
                        <span>Faaliyet günü: {formatDay(draft.activityDate)}</span>
                        <span aria-hidden className="text-line-strong">
                          ·
                        </span>
                        <span>Son kaydetme: {formatInstantShort(draft.updatedAt)}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <ButtonLink
                        href={`/activities/new?taslak=${draft.id}`}
                        variant="primary"
                        size="sm"
                      >
                        Devam et
                      </ButtonLink>
                      <DeleteDraftButton
                        id={draft.id}
                        title={draft.title.trim() === "" ? "Başlıksız taslak" : draft.title}
                      />
                    </div>
                  </div>
                </RecordItem>
              ))}
            </RecordList>
          )}

          <Pagination
            page={gecerliSayfa}
            pageCount={sayfaSayisi}
            hrefFor={(hedef) =>
              hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
            }
          />
        </Card>
      </Page>
    </AppShell>
  );
}
