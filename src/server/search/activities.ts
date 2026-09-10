import { Prisma } from "@prisma/client";

import { periodStart } from "@/server/activities/scope-feed";
import {
  queryVisibleActivities,
  type ActivityRepositoryDb,
} from "@/server/authz/activity-repository";
import type { Viewer } from "@/server/authz/visibility";

// Faaliyet araması (§16.2 tam metin indeksi). Sonuçlar **her zaman** görünürlük
// kapsamıyla sınırlıdır ve süzgeç sorgunun içindedir: önce metinle eşleşenleri
// bulup sonra daraltmak, kullanıcının göremediği kayıtların aday listesini
// doldurmasına ve kendi sonuçlarının sessizce dışarıda kalmasına yol açardı.
//
// İptal edilmiş kayıtlar aramada **kalır** ve "iptal" etiketiyle görünür
// (§5.5): silme yoktur, kayıt üstü çizili olarak durur.
//
// Sıralama alaka (`ts_rank`) sonra tarih; eşitlikte `id` ile kesinleşir, aksi
// halde sayfalar arasında satır tekrarlayabilir ya da atlanabilir.

/**
 * Metin indeksinin birebir karşılığı. İndeks `to_tsvector('turkish',
 * "title" || ' ' || "description")` ifadesi üzerinde tanımlı
 * (`20260817141637_veritabani_kisitlari`); sorgu aynı ifadeyi kullanmazsa
 * indeks kullanılmaz ve arama tam tarama olur.
 */
const DOCUMENT = Prisma.raw(`to_tsvector('turkish', a."title" || ' ' || a."description")`);

/** Sayfa başına sonuç. */
export const SEARCH_PAGE_SIZE = 25;

/**
 * Özetteki eşleşme işaretleyicileri. Kontrol karakterleri seçildi: kullanıcının
 * yazdığı metinde bulunmaları pratikte imkânsız, bulunsalar bile zararsız —
 * ekranda görünmezler.
 */
export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

const HEADLINE_OPTIONS = [
  "MaxWords=30",
  "MinWords=10",
  "ShortWord=3",
  "MaxFragments=1",
  `StartSel=${HIGHLIGHT_START}`,
  `StopSel=${HIGHLIGHT_END}`,
].join(", ");

/** Özeti işaretli ve işaretsiz parçalara böler; ekran bunu bileşene çevirir. */
export function splitHighlights(
  snippet: string,
): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  let kalan = snippet;

  while (kalan.length > 0) {
    const basla = kalan.indexOf(HIGHLIGHT_START);
    if (basla === -1) {
      parts.push({ text: kalan, marked: false });
      break;
    }

    if (basla > 0) parts.push({ text: kalan.slice(0, basla), marked: false });

    const bitir = kalan.indexOf(HIGHLIGHT_END, basla + 1);
    if (bitir === -1) {
      // Eşleşmemiş işaretleyici: kalanı düz metin say, hiçbir şey yutma.
      parts.push({ text: kalan.slice(basla + 1), marked: false });
      break;
    }

    parts.push({ text: kalan.slice(basla + 1, bitir), marked: true });
    kalan = kalan.slice(bitir + 1);
  }

  return parts.filter((part) => part.text.length > 0);
}

export type SearchDb = ActivityRepositoryDb;

export interface SearchHit {
  id: string;
  /** İnsan okur sıra numarası (§3.1). */
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  authorName: string;
  /** Yazarın unvanı; boş olabilir. */
  authorTitle: string | null;
  authorUnitName: string;
  /** Kaydın yazıldığı an; faaliyetin gününden ayrıdır (Görev 11.1). */
  createdAt: Date;
  /**
   * Kısa özet; eşleşen yerler `HIGHLIGHT_START`/`HIGHLIGHT_END` ile
   * çevrelenir. **HTML değildir** — `ts_headline` `<mark>` etiketi üretebilir
   * ama o çıktıyı ekrana basmak, kullanıcının yazdığı metni HTML olarak
   * çalıştırmak demekti. İşaretleme metin içinde taşınır, ekran onu
   * bileşene çevirir.
   */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Kapsam içindeki toplam eşleşme; "kaç sonuç var" sorusu sessiz kalmaz. */
  total: number;
  page: number;
  pageCount: number;
}

interface RawHit {
  id: string;
  activityNo: number;
  activityDate: Date;
  title: string;
  approvalStatus: string;
  authorName: string;
  authorTitle: string | null;
  authorUnitName: string;
  createdAt: Date;
  snippet: string;
}

/**
 * Aramaya uygulanan daraltmalar (Görev 10.9). Kapsam akışıyla **aynı** alanlar;
 * ortak süzgeç bileşeninden geliyorlar.
 *
 * **Süzgeç yetki vermez:** hepsi görünürlük süzgecinin üstüne ekleniyor, hiçbiri
 * kapsamı genişletemiyor.
 */
export interface SearchFilters {
  period: "today" | "week" | "all";
  authorId: string;
  authorOrgUnitId: string;
  targetOrgUnitId: string;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  period: "all",
  authorId: "",
  authorOrgUnitId: "",
  targetOrgUnitId: "",
};

/**
 * Daraltmaları SQL parçasına çevirir. Değerler **parametre olarak** gidiyor;
 * metin birleştirme yok — arama zaten ham SQL kullanıyor ve buradaki değerler
 * adres çubuğundan geliyor.
 */
function filterSql(filters: SearchFilters, now: Date): Prisma.Sql {
  const parcalar: Prisma.Sql[] = [];

  const start = periodStart(filters.period, now);
  if (start) parcalar.push(Prisma.sql`AND a."activityDate" >= ${start}`);

  if (filters.authorId !== "") {
    parcalar.push(Prisma.sql`AND a."authorId" = ${filters.authorId}`);
  }

  if (filters.authorOrgUnitId !== "") {
    parcalar.push(Prisma.sql`AND a."authorOrgUnitId" = ${filters.authorOrgUnitId}`);
  }

  if (filters.targetOrgUnitId !== "") {
    parcalar.push(Prisma.sql`
      AND EXISTS (
        SELECT 1 FROM "ActivityTargetDept" t
        WHERE t."activityId" = a."id" AND t."orgUnitId" = ${filters.targetOrgUnitId}
      )
    `);
  }

  return parcalar.length === 0 ? Prisma.empty : Prisma.join(parcalar, " ");
}

export async function searchActivities(
  db: SearchDb,
  viewer: Viewer,
  query: string,
  page = 1,
  pageSize = SEARCH_PAGE_SIZE,
  subordinates?: string[],
  filters: SearchFilters = EMPTY_SEARCH_FILTERS,
  now: Date = new Date(),
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed === "") return { hits: [], total: 0, page: 1, pageCount: 0 };

  const daraltma = filterSql(filters, now);
  const guvenliSayfa = Math.max(1, Math.trunc(page));
  const offset = (guvenliSayfa - 1) * pageSize;

  const [sayim] = await queryVisibleActivities<{ total: bigint }>(
    db,
    viewer,
    (scope) => Prisma.sql`
    SELECT count(*)::bigint AS total
    FROM "Activity" a, plainto_tsquery('turkish', ${trimmed}) q
    WHERE ${DOCUMENT} @@ q AND ${scope} ${daraltma}
  `,
    subordinates,
    now,
  );

  const total = Number(sayim?.total ?? 0);
  if (total === 0) {
    return { hits: [], total: 0, page: guvenliSayfa, pageCount: 0 };
  }

  const rows = await queryVisibleActivities<RawHit>(
    db,
    viewer,
    (scope) => Prisma.sql`
    SELECT
      a."id",
      a."activityNo",
      a."activityDate",
      a."title",
      a."approvalStatus"::text AS "approvalStatus",
      a."createdAt",
      u."fullName" AS "authorName",
      u."title" AS "authorTitle",
      o."name" AS "authorUnitName",
      ts_headline('turkish', a."description", q, ${HEADLINE_OPTIONS}) AS "snippet"
    FROM "Activity" a
    JOIN "User" u ON u."id" = a."authorId"
    JOIN "OrgUnit" o ON o."id" = a."authorOrgUnitId",
      plainto_tsquery('turkish', ${trimmed}) q
    WHERE ${DOCUMENT} @@ q AND ${scope} ${daraltma}
    ORDER BY ts_rank(${DOCUMENT}, q) DESC, a."activityDate" DESC, a."id" DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `,
    subordinates,
    now,
  );

  return {
    hits: rows,
    total,
    page: guvenliSayfa,
    pageCount: Math.ceil(total / pageSize),
  };
}
