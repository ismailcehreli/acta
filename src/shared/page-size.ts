// "Sayfada kaç kayıt" tercihinin **paylaşılan** kısmı.
//
// İzinli değerler ve doğrulama hem sunucuda hem istemcide gerekiyor; çereze
// yazan seçici bir istemci bileşeni ve `next/headers` kullanan sunucu
// yardımcısıyla aynı dosyada duramıyor (istemci paketine sunucu modülü
// giremez). Kural yine tek yerde: burada.

export const PAGE_SIZE_COOKIE = "page_size";

/** Seçilebilen değerler. Liste dışındaki her şey reddedilir. */
export const PAGE_SIZES = [25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Serbest metni izinli değere indirger; tanınmayan her şey `null`. */
export function normalizePageSize(value: string | undefined | null): PageSize | null {
  if (!value) return null;

  const sayi = Number.parseInt(value, 10);
  return (PAGE_SIZES as readonly number[]).includes(sayi) ? (sayi as PageSize) : null;
}
