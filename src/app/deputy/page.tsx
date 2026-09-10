import { redirect } from "next/navigation";

import {
  listCoveredPeriods,
  listDeputyDecisions,
  countDeputyPeriods,
  listDeputyPeriods,
  type DeputyPeriodFilters,
  type DeputyPeriod,
} from "@/server/absence/deputy-read";
import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { AppShell } from "@/components/shell/app-shell";
import { toShellUser } from "@/components/shell/shell-user";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordItem, RecordList } from "@/components/ui/table";

import { KararListesi } from "./decision-list";
import { formatDay } from "@/shared/format/date-time";
import { resolvePageSize } from "@/server/preferences/page-size";
import { FilterBar } from "@/components/filters/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { buildQueryAddress } from "@/shared/filters/query-address";

// Vekâlet (§4.5, ürün sahibi kararı 21.08.2026).
//
// Sayfa **iki yüzle** çalışır ve ikisi de aynı veriden beslenir:
//
//   · **Vekile:** hangi dönemlerde kimin yerine baktım, ne karar verdim.
//   · **Dönen yöneticiye:** yokluğumda kim baktı, ne karar verdi.
//
// Vekâletle verilen kararlar denetim izinden okunuyor; iz değişmez ve
// **kimin adına** karar verildiğini de taşıyor.

export const metadata = { title: "Vekâlet" };

function araMetni(start: Date, end: Date): string {
  return `${formatDay(start)} – ${formatDay(end)}`;
}

export default async function DeputyPage({
  searchParams,
}: {
  searchParams: Promise<{ kisi?: string; sayfa?: string; boyut?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const now = new Date();

  const filters: DeputyPeriodFilters = { personId: params.kisi || undefined };
  const SAYFA_BOYU = await resolvePageSize(params.boyut);
  const istenen = Number.parseInt(params.sayfa ?? "1", 10);
  const sayfa = Number.isFinite(istenen) && istenen > 0 ? istenen : 1;

  // İki ayrı okuma, çünkü iki ayrı soruya cevap veriyorlar:
  //
  //   `vekaletEttiklerim` — kararların hesaplandığı **tam** küme. Süzgeç ya da
  //   sayfa buraya girerse, ikinci sayfadaki bir dönemin kararları hiç
  //   yüklenmez ve "o dönemde ne yaptım" sorusu cevapsız kalır (§4.5).
  //
  //   `listelenen` — kartta gösterilen, süzgeçli ve sayfalı küme.
  const [vekaletEttiklerim, yerimeBakanlar, shellUser, toplamDonem] =
    await Promise.all([
      listDeputyPeriods(prisma, user.id, now),
      listCoveredPeriods(prisma, user.id),
      toShellUser(user),
      countDeputyPeriods(prisma, user.id, filters),
    ]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplamDonem / SAYFA_BOYU));
  const gecerliSayfa = Math.min(sayfa, sayfaSayisi);

  const listelenen = await listDeputyPeriods(prisma, user.id, now, filters, {
    limit: SAYFA_BOYU,
    skip: (gecerliSayfa - 1) * SAYFA_BOYU,
  });

  const adres = (ek: Record<string, string> = {}) =>
    buildQueryAddress(
      "/deputy",
      { kisi: params.kisi, boyut: String(SAYFA_BOYU) },
      ek,
    );

  // Süzgeç seçenekleri kendi vekâlet geçmişinden gelir: başka kimsenin adı
  // burada görünmez.
  const kisiler = [
    ...new Map(
      vekaletEttiklerim.map((d) => [d.personId, d.personName]),
    ).entries(),
  ].map(([id, ad]) => ({ value: id, label: ad }));

  // Kararlar **bütün** dönemler için yüklenir, yalnız aktif olanlar için
  // değil (denetim 21.08.2026, bulgu 15). Geçmiş dönemde yalnız bir
  // sayı görünüyordu; oysa §4.5'in bütün gerekçesi, vekilin aylar sonra
  // "o dönemde ne yaptım" sorusuna cevap verebilmesi.
  const kararlar = await Promise.all(
    vekaletEttiklerim.map(async (donem) => ({
      donem,
      kararlar: await listDeputyDecisions(
        prisma,
        {
          personId: donem.personId,
          deputyId: user.id,
          startDate: donem.startDate,
          endDate: donem.endDate,
        },
        user.id,
      ),
    })),
  );

  // Dönen yönetici de yokluğunda ne olduğunu **liste hâlinde** görür (§4.5).
  // Önceden yalnız bir sayı vardı; "yokluğumda ne oldu" sorusunun cevabı
  // sayı değildir (denetim 21.08.2026, bulgu 15).
  const yerimeBakanlarKararlari = await Promise.all(
    yerimeBakanlar.map(async (donem) => ({
      donem,
      kararlar: await listDeputyDecisions(
        prisma,
        {
          personId: user.id,
          deputyId: donem.personId,
          startDate: donem.startDate,
          endDate: donem.endDate,
        },
        user.id,
      ),
    })),
  );

  const aktif = vekaletEttiklerim.filter((donem) => donem.active);
  const aktifKararlar = kararlar.filter(({ donem }) => donem.active);
  // Biten dönemler katlanmış gelir: vekil çoğunlukla "şu an ne yaptım" diye
  // bakar, geçmişe ise arayarak iner.
  const gecmisKararlar = kararlar.filter(
    ({ donem, kararlar: liste }) => !donem.active && liste.length > 0,
  );

  return (
    <AppShell user={shellUser}>
      <Page>
        <PageHeader
          marker="Vekâlet"
          title="Vekâlet"
          description="Bir yönetici izne çıktığında yerine bakan kişi, o süre boyunca onun departmanını görür ve kararlarını verebilir. Süre bitince yeni kayıtlar kapanır; o döneme ait olanları ve verdiği kararları görmeye devam eder — ileride o dönemle ilgili bir soru gelirse cevaplayabilsin diye."
          breadcrumbs={[{ label: "Ana ekran", href: "/" }, { label: "Vekâlet" }]}
        />

        {aktif.length > 0 ? (
          <div
            data-test="aktif-vekalet"
            className="border-y border-primary-line bg-primary-soft px-4 py-3.5 sm:px-5"
          >
            <p className="section-label text-primary">Şu an vekâlet ediyorsunuz</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {aktif.map((donem) => (
                <li key={donem.id} className="text-[length:var(--text-sm)] text-ink">
                  <strong className="font-semibold">{donem.personName}</strong> —{" "}
                  {donem.personUnitName} · {araMetni(donem.startDate, donem.endDate)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {aktifKararlar.map(({ donem, kararlar }) => (
          <Card key={`aktif-${donem.id}`}>
            <CardHeader
              title={`${donem.personName} adına verdiğiniz kararlar`}
              description="Bu dönemde sizin verdiğiniz onay, düzeltme ve ret kararları."
            />
            <KararListesi kararlar={kararlar} />
          </Card>
        ))}

        <Card>
          <CardHeader
            title="Vekâlet ettiğim dönemler"
            description="Geçmiş dönemler dahil. Kapsam kapansa da o dönemin kayıtlarını ve verdiğiniz kararları görmeye devam edersiniz."
          />
          <FilterBar
            action="/deputy"
            clearHref="/deputy"
            filtered={Boolean(params.kisi)}
            pageSize={SAYFA_BOYU}
            fields={[
              {
                name: "kisi",
                label: "Yerine baktığım kişi",
                value: params.kisi ?? "",
                width: "w-56",
                options: [{ value: "", label: "Herkes" }, ...kisiler],
              },
            ]}
          />

          <DonemListesi
            donemler={listelenen}
            bosluk={
              params.kisi
                ? "Süzgece uyan dönem yok."
                : "Henüz kimseye vekâlet etmediniz."
            }
          />

          <Pagination
            page={gecerliSayfa}
            pageCount={sayfaSayisi}
            hrefFor={(hedef) =>
              hedef === 1 ? adres() : adres({ sayfa: String(hedef) })
            }
          />
        </Card>

        {gecmisKararlar.map(({ donem, kararlar: liste }) => (
          <Card key={`gecmis-${donem.id}`}>
            <details data-test="gecmis-kararlar">
              <summary className="cursor-pointer list-none px-5 py-4 text-[length:var(--text-sm)] font-medium text-ink">
                {donem.personName} adına verdiğiniz kararlar ·{" "}
                {araMetni(donem.startDate, donem.endDate)}
              </summary>
              <KararListesi kararlar={liste} />
            </details>
          </Card>
        ))}

        <Card>
          <CardHeader
            title="Yokluğumda yerime bakanlar"
            description="Siz izinliyken kim baktı ve kaç karar verdi."
          />
          <DonemListesi
            donemler={yerimeBakanlar}
            bosluk="İzin döneminiz için vekil tanımlanmamış."
          />
        </Card>

        {yerimeBakanlarKararlari
          .filter(({ kararlar: liste }) => liste.length > 0)
          .map(({ donem, kararlar: liste }) => (
            <Card key={`yerime-${donem.id}`}>
              <details data-test="yerime-bakan-kararlari">
                <summary className="cursor-pointer list-none px-5 py-4 text-[length:var(--text-sm)] font-medium text-ink">
                  {donem.personName} sizin adınıza ·{" "}
                  {araMetni(donem.startDate, donem.endDate)}
                </summary>
                <KararListesi kararlar={liste} />
              </details>
            </Card>
          ))}
      </Page>
    </AppShell>
  );
}

function DonemListesi({
  donemler,
  bosluk,
}: {
  donemler: DeputyPeriod[];
  bosluk: string;
}) {
  if (donemler.length === 0) {
    return <EmptyState title="Kayıt yok" description={bosluk} />;
  }

  return (
    <RecordList>
      {donemler.map((donem) => (
        <RecordItem key={donem.id} data-test="vekalet-donemi" className="sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-ink">{donem.personName}</span>
              <span className="text-[length:var(--text-sm)] text-muted">
                {donem.personUnitName}
              </span>
              {donem.active ? <Badge tone="primary">Sürüyor</Badge> : null}
            </p>
            <span className="text-[length:var(--text-sm)] text-muted">
              <span className="tabular font-semibold text-ink">
                {donem.decisionCount}
              </span>{" "}
              karar
            </span>
          </div>

          <p className="mt-1 text-[length:var(--text-xs)] text-faint">
            {araMetni(donem.startDate, donem.endDate)}
            {donem.note ? ` · ${donem.note}` : ""}
          </p>
        </RecordItem>
      ))}
    </RecordList>
  );
}
