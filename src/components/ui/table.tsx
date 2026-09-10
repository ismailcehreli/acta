import type { ReactNode } from "react";

// Tablo — kayıt defteri.
//
// Zebra yok, dış çerçeve yok: satırlar yalnız ince kural çizgisiyle ayrılır.
// Başlık satırı versal, monospace ve küçük — teknik föy karakteri.
//
// Dar ekranda **günlük kullanılan** geniş tablolar `RecordList` bileşenine
// dönüşür (aşağıda): her satır etiketli alanlardan oluşan bir kayıt olur,
// sütun ilişkisi kaybolmaz (brief §5 mobil).
//
// Yönetim ekranlarındaki tablolar tablo kalır — yedi sütunlu denetim izi
// kayıt kartına dönüştüğünde taranabilirliğini kaybeder ve o ekranın işi
// zaten masaüstünde yapılır. Onlar için kaydırma alanı **klavyeyle de**
// gezilebilir olmalı: aşağıdaki sarmalayıcı odaklanabilir ve adlandırılmış
// bir bölge (WCAG 2.1.1).

export type Align = "left" | "right" | "center";

const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function Table({
  children,
  label,
}: {
  children: ReactNode;
  /** Kaydırma alanına ad verir; yalnız yatay kaydırma gerekebilecek geniş
   *  tablolarda anlamlı. Verilmezse sarmalayıcı odaklanabilir olmaz. */
  label?: string;
}) {
  return (
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      {...(label ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      <table className="w-full border-collapse text-[length:var(--text-sm)]">
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line-strong">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`transition-colors duration-(--duration-fast) hover:bg-surface-hover ${className ?? ""}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`section-label px-3 py-2.5 ${ALIGN[align]} ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = "left",
  className,
  colSpanAll,
  ...props
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
  /** Satırın tamamını kaplayan hücre (satır içi detay panelleri için). */
  colSpanAll?: boolean;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      colSpan={colSpanAll ? 99 : props.colSpan}
      className={`px-3 py-3 align-top text-ink ${ALIGN[align]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </td>
  );
}

/**
 * Kayıt listesi — tablonun dar ekran karşılığı.
 *
 * Her kayıt, etiketi görünen alanlardan oluşur. Tabloyu küçültmek yerine
 * biçim değiştirmenin sebebi şu: 390 px'de altı sütunlu bir tablo ya
 * okunamaz ya da yatay kaydırma ister; ikisi de sahada telefonla bakan
 * kullanıcı için kullanılamaz demektir.
 */
export function RecordList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>;
}

export function RecordItem({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li className={`px-4 py-3.5 ${className ?? ""}`} {...props}>
      {children}
    </li>
  );
}

/** Kayıt içindeki tek alan: etiket üstte küçük, değer altta. */
export function RecordField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className="section-label">{label}</span>
      <span className="text-[length:var(--text-sm)] text-ink">{children}</span>
    </div>
  );
}
