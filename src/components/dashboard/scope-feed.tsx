import Link from "next/link";

import type { FeedItem } from "@/server/activities/scope-feed";
import { Badge, ReadDot } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import {
  formatDayLong,
  formatDayShort,
  formatInstantShort,
} from "@/shared/format/date-time";
import {
  ActivityFilters,
  type FilterOptions,
  type FilterValues,
} from "@/components/filters/activity-filters";

// Kapsam akışı (§13.1). Okunmamışlar belirgin, okunmuşlar sönük: yöneticinin
// ihtiyacı "hangilerine baktım" sorusudur, bir durum alanı değil (§10.1).
//
// Düzen her kademede aynıdır; değişen yalnız başlık ve kapsamın genişliği
// (§13.1). Öğrenilecek tek bir arayüz olur.

/**
 * Kayıtları güne göre gruplar (brief §6, katman 3).
 *
 * Kayıt defteri karakterinin taşıyıcısı: liste düz bir akış değil, tarih
 * şeritleriyle bölünmüş bir defter sayfasıdır. Sunucunun seçtiği sıra korunur;
 * ana akış yeniden eskiye, dikkat kuyruğu eskiden yeniye akar.
 */
function gunlereBol(items: FeedItem[]): { gun: string; date: Date; items: FeedItem[] }[] {
  const gruplar: { gun: string; date: Date; items: FeedItem[] }[] = [];

  for (const item of items) {
    const anahtar = item.activityDate.toISOString().slice(0, 10);
    const son = gruplar[gruplar.length - 1];
    if (son && son.gun === anahtar) son.items.push(item);
    else gruplar.push({ gun: anahtar, date: item.activityDate, items: [item] });
  }

  return gruplar;
}

export type FeedFilterOptions = FilterOptions;

/**
 * Akıştaki tek kayıt satırı.
 *
 * Ana ekrandaki kısa önizleme ile akış sayfası **aynı** satırı kullanır:
 * iki yerde ayrı ayrı yazılsaydı biri değiştiğinde diğeri sessizce
 * geride kalırdı.
 */
export function FeedRow({ item }: { item: FeedItem }) {
  const iptal = item.approvalStatus === "CANCELLED";

  return (
    // `data-okundu` makine tarafından okunabilir durum: uçtan uca testler
    // rozete değil buna bakar.
    <li
      key={item.id}
      data-test="akis-satiri"
      data-okundu={item.read ? "evet" : "hayir"}
    >
      <Link
        href={`/activities/${item.id}`}
        className={[
          "flex items-start gap-3 px-4 py-3 transition-colors sm:px-5",
          "duration-(--duration-fast) hover:bg-surface-hover",
          item.read ? "" : "edge-mark text-primary",
        ].join(" ")}
      >
        <ReadDot read={item.read} />

        {/* Yazarın yüzü satırın başında: kim yazdı sorusu adı okumadan
            cevaplanır (Görev 11.5). */}
        <Avatar
          user={{
            id: item.authorId,
            fullName: item.authorName,
            avatarExtension: item.authorAvatarExtension,
          }}
          size={28}
          className="mt-0.5"
        />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* Sıra numarası (§3.1): kayda atıf vermenin kısa yolu. */}
            <span className="mono shrink-0 text-[length:var(--text-xs)] text-faint">
              #{item.activityNo}
            </span>
            <span
              className={
                iptal
                  ? "min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-faint line-through"
                  : "min-w-0 flex-1 truncate text-[length:var(--text-sm)] font-medium text-ink"
              }
            >
              {item.title}
            </span>
            {iptal ? <Badge tone="cancelled">İptal edildi</Badge> : null}
            {!item.read && !iptal && item.approvalStatus !== "REJECTED" ? (
              <Badge tone="waiting">Okunmadı</Badge>
            ) : null}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-muted">
            <span className="font-medium text-ink">{item.authorName}</span>
            {/* Unvan yetki değildir; okuyanın "bu kişi ne iş yapıyor"
                sorusuna cevap verir. Boşsa ayraç da yazılmaz. */}
            {item.authorTitle ? (
              <>
                <span aria-hidden className="text-line-strong">·</span>
                <span>{item.authorTitle}</span>
              </>
            ) : null}
            <span aria-hidden className="text-line-strong">·</span>
            <span>{item.authorUnitName}</span>
            {item.targetDepartmentNames.length > 0 ? (
              <>
                <span aria-hidden className="text-line-strong">·</span>
                <span className="text-faint">
                  {item.targetDepartmentNames.join(", ")}
                </span>
              </>
            ) : null}
            <span aria-hidden className="text-line-strong">·</span>
            <time dateTime={item.createdAt.toISOString()} className="text-faint">
              Kaydedildi: {formatInstantShort(item.createdAt)}
            </time>
          </span>
        </span>

        {/* Sağ sütun **yalnız faaliyetin günü**. Kaydın yazıldığı an alt
            satırda, etiketiyle birlikte duruyor.

            Önce ikisi burada alt alta yazılıyordu ve "20 Ağu / 20:42" tek
            bir tarih-saat gibi okunuyordu — oysa 20 Ağustos tarihli kayıt
            21 Ağustos'ta yazılmıştı. Etiketsiz iki sayıyı yan yana koymak,
            aralarındaki ilişkiyi okuyucunun tahminine bırakıyor. */}
        <time
          dateTime={item.activityDate.toISOString().slice(0, 10)}
          className="mono shrink-0 pt-0.5 text-[length:var(--text-xs)] text-faint"
        >
          {formatDayShort(item.activityDate)}
        </time>
      </Link>
    </li>
  );
}

export function ScopeFeed({
  label,
  items,
  filters,
  selected,
  nextPageHref,
  statusLabel,
  clearStatusHref,
  unreadOnly = false,
  unreadHref,
  clearUnreadHref,
  personCount,
  unreadCount,
  totalCount,
  pageSize,
  firstPageHref,
  clearHref = "/",
}: {
  label: string;
  items: FeedItem[];
  filters: FeedFilterOptions;
  selected: FilterValues;
  nextPageHref?: string | null;
  /**
   * Sayaçtan gelen durum daraltmasının adı ("onay bekleyenler" gibi).
   * Daraltma **görünür** olmalı: liste kısaldığında kullanıcı bunun bir
   * süzgeçten mi yoksa veri yokluğundan mı olduğunu bilmeli.
   */
  statusLabel?: string | null;
  /** Durum daraltmasını kaldıran adres. */
  clearStatusHref?: string;
  /** Yalnız okunmamış kayıtların gösterildiği akış filtresi. */
  unreadOnly?: boolean;
  /** Sayaç rozetinin açtığı okunmamış akış adresi. */
  unreadHref?: string;
  /** Okunmamış filtresini kaldıran, diğer süzgeçleri koruyan adres. */
  clearUnreadHref?: string;
  /** Kapsamdaki kişi sayısı; başlığın yanında bağlam verir. */
  personCount?: number;
  /** Kapsamdaki okunmamış kayıt sayısı; sıfırsa rozet çizilmez. */
  unreadCount?: number;
  /** Süzgeçli kapsamın toplam kayıt sayısı; sayfalama başlığında. */
  totalCount?: number;
  /** Bir sayfada kaç kayıt; "1-50 / 312" yazabilmek için. */
  pageSize?: number;
  /** İmleçli sayfada başa dönüş adresi. */
  firstPageHref?: string | null;
  /** Süzgeçleri temizleyen adres; sayfa kendi yolunu verir. */
  clearHref?: string;
}) {
  return (
    <Card id="kapsam" className="scroll-mt-6">
      {/* Süzgeç kutularının `key`i seçili değerdir.
          Sebep: `defaultValue` yalnız **bağlanma anında** DOM'a yazılır.
          Departman özetinden gelen bağlantı yumuşak gezinme yapıyor, React
          aynı `<select>` düğümünü yeniden kullanıyor ve kutu eski değerde
          kalıyordu — liste daralmış, süzgeç "Hepsi" görünüyordu. `key`
          değişince düğüm yeniden bağlanıyor ve adresle uyumlu oluyor. */}
      <CardHeader
        title={label}
        description={
          personCount === undefined
            ? undefined
            : `${personCount} kişinin kayıtları`
        }
        action={
          <span className="flex items-center gap-2">
            {/* Okunmamış sayısı kapsamın tamamına aittir, bu sayfaya değil:
                süzgeç daralttığında bile "kaç iş bekliyor" değişmemeli.

                Daraltma varken rozet **kapsamda** diyor: yan yana duran
                "0 kayıt" ile "2 okunmamış" birbiriyle çelişiyormuş gibi
                görünüyordu (Görev 11.2). İki sayı iki farklı şeyi ölçüyor;
                etiket bunu söylüyor. */}
            {unreadCount ? (
              unreadOnly ? (
                <Badge tone="waiting">
                  {statusLabel || unreadOnly ? "kapsamda " : ""}
                  {unreadCount} okunmamış
                </Badge>
              ) : (
                <Link
                  href={unreadHref ?? "/feed?period=all&okunmamis=1"}
                  className="rounded-(--radius-xs) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  data-test="okunmamis-akis-link"
                >
                  <Badge tone="waiting">
                    {statusLabel ? "kapsamda " : ""}
                    {unreadCount} okunmamış
                  </Badge>
                </Link>
              )
            ) : null}
            <Badge tone="primary">
              {totalCount === undefined
                ? `${items.length} kayıt`
                : pageSize !== undefined && totalCount > pageSize
                  ? `${items.length} / ${totalCount} kayıt`
                  : `${totalCount} kayıt`}
            </Badge>
          </span>
        }
      />

      <ActivityFilters
        options={filters}
        selected={selected}
        clearHref={clearHref}
        pageSize={pageSize}
        unreadOnly={unreadOnly}
        hidden={unreadOnly ? [{ name: "okunmamis", value: "1" }] : undefined}
      />

      {unreadOnly ? (
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-waiting-soft px-4 py-2.5 sm:px-5"
          data-test="okunmamis-filtresi"
        >
          <p className="text-[length:var(--text-sm)] text-ink">
            Yalnızca <strong className="font-semibold">okunmamış faaliyetler</strong>{" "}
            gösteriliyor.
          </p>
          <Link
            href={clearUnreadHref ?? "/feed"}
            className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
          >
            Okunmamış filtresini kaldır
          </Link>
        </div>
      ) : null}

      {statusLabel ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-inset px-4 py-2.5">
          <p className="text-[length:var(--text-sm)] text-ink">
            Yalnızca <strong className="font-semibold">{statusLabel}</strong>{" "}
            gösteriliyor.
          </p>
          <Link
            href={clearStatusHref ?? "/"}
            className="text-[length:var(--text-sm)] text-primary underline-offset-4 hover:underline"
          >
            Daraltmayı kaldır
          </Link>
        </div>
      ) : null}

      {items.length === 0 ? (
        // Boşluğun sebebi metne yansır: daraltma varken "bu aralıkta kayıt
        // yok" demek, kullanıcıyı dönemi genişletmeye yönlendiriyordu — oysa
        // listeyi boşaltan şey dönem değil, durum süzgeciydi (Görev 11.2).
        statusLabel || unreadOnly ? (
          <EmptyState
            title={
              unreadOnly
                ? "Kapsamınızda okunmamış faaliyet yok."
                : "Kapsamınızda " + statusLabel + " yok."
            }
            description="Daraltmayı kaldırarak bütün kayıtları görebilirsiniz."
          />
        ) : (
          <EmptyState
            title="Bu aralıkta kayıt yok."
            description="Dönemi genişletmeyi ya da süzgeci temizlemeyi deneyin."
          />
        )
      ) : (
        <div>
          {gunlereBol(items).map((grup) => (
            <section key={grup.gun} aria-label={formatDayLong(grup.date)}>
              {/* Tarih şeridi: defterin gün ayracı. Yapışkan değil —
                  uzun listede sürekli üstte duran bir şerit, okunan
                  satırın bağlamını değil ekranın üstünü doldurur. */}
              <h3 className="section-label flex items-center gap-3 border-y border-line bg-inset/60 px-4 py-2 sm:px-5">
                <span>{formatDayLong(grup.date)}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
                <span className="mono">{grup.items.length}</span>
              </h3>

              <ul className="divide-y divide-line">
                {grup.items.map((item) => (
                  <FeedRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}

          {nextPageHref || firstPageHref ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3.5 sm:px-5">
              {firstPageHref ? (
                <ButtonLink href={firstPageHref} size="sm">
                  Başa dön
                </ButtonLink>
              ) : null}
              {nextPageHref ? (
                <ButtonLink href={nextPageHref} data-test="sonraki-sayfa" size="sm">
                  Sonraki sayfa
                </ButtonLink>
              ) : null}
              {/* İmleçli sayfalamada numaralı sayfa yok; sebebi sayfa
                  dosyasında yazılı. Kullanıcı kaybolmasın diye toplam
                  yazılıyor. */}
              {totalCount !== undefined ? (
                <span className="ms-auto text-[length:var(--text-xs)] text-faint">
                  Toplam {totalCount} kayıt
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
