// Gezinme ikonları.
//
// Tek bir outline ailesi, tutarlı 1.6 stroke, 20×20 ızgara. İkon **hiçbir
// zaman metin etiketinin yerine geçmez** (§3) — her zaman bir etiketin
// yanında durur ve `aria-hidden` taşır.

type IkonAdi =
  | "bugun"
  | "faaliyet"
  | "onay"
  | "takip"
  | "arama"
  | "yardim"
  | "geriBildirim"
  | "ekip"
  | "yonetim"
  | "akis"
  | "vekalet"
  | "taslak"
  | "izin"
  | "skor"
  | "rapor"
  | "yeni"
  | "daha"
  | "zil"
  | "hesap";

const YOLLAR: Record<IkonAdi, React.ReactNode> = {
  // Vardiya panosu: tarih şeridi + işaretli gün
  // Skor: yükselen sütunlar
  skor: (
    <>
      <path d="M4 16v-4M10 16V7M16 16v-6" strokeWidth="2" />
      <path d="M3 17.5h14" />
    </>
  ),
  // Rapor: karşılaştırılabilir özet satırları
  rapor: (
    <>
      <path d="M4 3.5h9l3 3v10H4z" />
      <path d="M7 9h6M7 12h6M7 15h3" />
      <path d="M13 3.5v3h3" />
    </>
  ),
  // İzin günleri: takvimde işaretlenmiş bir aralık
  izin: (
    <>
      <path d="M3 6h14v11H3z" />
      <path d="M3 9.5h14M7 3.5v3M13 3.5v3" />
      <path d="M6 12.5h8" strokeWidth="2" />
    </>
  ),
  bugun: (
    <>
      <path d="M3 6h14v11H3z" />
      <path d="M3 9.5h14M7 3.5v3M13 3.5v3" />
      <path d="M6.5 12.5h3v3h-3z" fill="currentColor" stroke="none" />
    </>
  ),
  // Akış: üst üste kayan satırlar
  akis: (
    <>
      <path d="M3 5.5h9M3 10h14M3 14.5h11" />
      <path d="M15 5.5h2M16 14.5h1" />
    </>
  ),
  // Vekâlet: iki kişi, biri diğerinin yerinde
  vekalet: (
    <>
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <path d="M13 6.5h4.5M15.5 4.5l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Taslak: köşesi kıvrık, yarım kalmış sayfa
  taslak: (
    <>
      <path d="M5 2.5h7l3 3v12H5z" />
      <path d="M12 2.5v3h3" />
      <path d="M8 10h4M8 13h2" strokeDasharray="2 1.5" />
    </>
  ),
  // Kayıt defteri sayfası
  faaliyet: (
    <>
      <path d="M5 2.5h10v15H5z" />
      <path d="M8 6h4M8 9h4M8 12h2.5" />
    </>
  ),
  // Onay: kutu + işaret
  onay: (
    <>
      <path d="M3.5 4.5h13v11h-13z" />
      <path d="M7 10l2 2 4-4.5" />
    </>
  ),
  // Takip: açık halka, kapanmamış konu
  takip: (
    <>
      <path d="M16.5 10a6.5 6.5 0 1 1-3-5.5" />
      <path d="M10 6v4.2l2.8 1.8" />
    </>
  ),
  arama: (
    <>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2 17 17" />
    </>
  ),
  yardim: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M7.8 7.8a2.4 2.4 0 1 1 3.9 1.8c-.9.7-1.7 1.2-1.7 2.5" />
      <path d="M10 15.2v.1" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  geriBildirim: (
    <>
      <path d="M3 4.5h14v9H9l-4 3v-3H3z" />
      <path d="M6.5 8h7M6.5 10.8h4" />
    </>
  ),
  ekip: (
    <>
      <circle cx="7.5" cy="7" r="2.8" />
      <path d="M2.5 16c0-2.6 2.2-4.5 5-4.5s5 1.9 5 4.5" />
      <path d="M13 5.2a2.6 2.6 0 0 1 0 5M14.5 15.6c0-1.6-.6-3-1.6-4" />
    </>
  ),
  // Yönetim: ayar anahtarı yerine sistem şeması
  yonetim: (
    <>
      <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3" />
      <circle cx="10" cy="10" r="3.5" />
    </>
  ),
  yeni: (
    <>
      <path d="M10 4.5v11M4.5 10h11" />
    </>
  ),
  daha: (
    <>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </>
  ),
  zil: (
    <>
      <path d="M15.5 8.5a5.5 5.5 0 1 0-11 0c0 3.9-1.1 5.2-1.7 5.8-.4.4-.1 1.2.5 1.2h13.4c.6 0 .9-.8.5-1.2-.6-.6-1.7-1.9-1.7-5.8Z" />
      <path d="M8.2 18a2 2 0 0 0 3.6 0" />
    </>
  ),
  hesap: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 16.5c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5" />
    </>
  ),
};

export function NavIcon({
  name,
  className,
}: {
  name: IkonAdi;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className ?? "size-5 shrink-0"}
    >
      {YOLLAR[name]}
    </svg>
  );
}

export type { IkonAdi };
