import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { splitHighlights, type SearchHit } from "@/server/search/activities";
import { formatDay, formatInstant } from "@/shared/format/date-time";

// Arama sonuçları (§16.2). Özet düz metindir; işaretleme metin içinde taşınan
// belirteçlerden bileşene çevrilir — `ts_headline` çıktısını HTML olarak
// basmak, kullanıcının yazdığı metni çalıştırmak demekti.

function Ozet({ snippet }: { snippet: string }) {
  return (
    <p className="mt-1.5 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
      {splitHighlights(snippet).map((part, index) =>
        part.marked ? (
          <mark
            key={index}
            className="rounded-sm bg-waiting-soft px-0.5 text-ink"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export function SearchResults({
  hits,
  total,
  page,
  pageCount,
  sayfaAdresi,
  query,
}: {
  hits: SearchHit[];
  total: number;
  page: number;
  pageCount: number;
  /**
   * Sayfa bağlantılarını üretir. Bileşen kendi adresini kuramaz: süzgeçleri
   * yalnız sayfa bilir ve bileşen içinde kurulan adres onları düşürüyordu
   * (Görev 11.3).
   */
  sayfaAdresi: (hedef: number) => string;
  query: string;
}) {
  if (query === "") {
    return (
      <Card>
        <EmptyState
          title="Arama yapın"
          description="Aramak istediğiniz kelimeyi yazın. Başlık ve açıklama içinde aranır."
        />
      </Card>
    );
  }

  if (total === 0) {
    return (
      <Card>
        <EmptyState
          title={`"${query}" için sonuç bulunamadı`}
          description="Farklı bir kelime deneyin. Yalnızca görebildiğiniz kayıtlar aranır."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Kaç sonuç olduğu hep yazılır: liste sessizce kesilmiş gibi görünmesin. */}
      <p className="text-[length:var(--text-sm)] text-muted">
        {total} sonuç · sayfa {page}/{pageCount}
      </p>

      <ul className="flex flex-col gap-2">
        {hits.map((hit) => (
          <li key={hit.id} data-test="arama-sonucu">
            <Card className="transition-colors hover:border-line-strong">
              <div className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-2">
                  {/* Sıra numarası (§3.1). */}
                  <span className="text-[length:var(--text-xs)] text-muted tabular">
                    #{hit.activityNo}
                  </span>
                  <Link
                    href={`/activities/${hit.id}`}
                    className={
                      hit.approvalStatus === "CANCELLED"
                        ? "font-medium text-ink line-through hover:text-primary"
                        : "font-medium text-ink hover:text-primary"
                    }
                  >
                    {hit.title}
                  </Link>
                  {hit.approvalStatus === "CANCELLED" ? (
                    <Badge>iptal</Badge>
                  ) : null}
                </div>

                <p className="mt-0.5 text-[length:var(--text-xs)] text-muted">
                  {hit.authorName}
                  {hit.authorTitle ? ` · ${hit.authorTitle}` : ""} ·{" "}
                  {hit.authorUnitName} · {formatDay(hit.activityDate)} ·{" "}
                  <span className="text-faint">
                    kaydedildi {formatInstant(hit.createdAt)}
                  </span>
                </p>

                <Ozet snippet={hit.snippet} />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-end gap-2">
          {page > 1 ? (
            <ButtonLink size="sm" href={sayfaAdresi(page - 1)}>
              Önceki
            </ButtonLink>
          ) : null}
          {page < pageCount ? (
            <ButtonLink
              size="sm"
              href={sayfaAdresi(page + 1)}
              data-test="sonraki-sayfa"
            >
              Sonraki
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
