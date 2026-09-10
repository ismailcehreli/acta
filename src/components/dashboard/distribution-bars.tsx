import Link from "next/link";

// Dağılım — yatay oran çubukları.
//
// Pasta grafiği bilerek yok: beş dilimli bir pastada iki dilimi gözle
// karşılaştırmak neredeyse imkânsızdır. Yatay çubuklar ortak bir tabana
// hizalanır ve okuma tek bakışta olur.
//
// Her satır sayıyı da yazar: çubuk bir sezgi, sayı bir bilgidir. Renk tek
// taşıyıcı değil — etiket ve sayı zaten metin.

export interface DistributionRow {
  key: string;
  label: string;
  count: number;
  /** Etiketin altında duran kısa bağlam ("3 kişi · bugün 2 yazdı" gibi). */
  hint?: string;
  /** Satır tıklanabilirse gidilecek adres. */
  href?: string;
  /** Vurgu tonu; verilmezse nötr. */
  tone?: "primary" | "success" | "waiting" | "correction" | "danger" | "cancelled";
}

const TON: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  waiting: "bg-waiting",
  correction: "bg-correction",
  danger: "bg-danger",
  cancelled: "bg-line-strong",
};

export function DistributionBars({
  rows,
  emptyText = "Bu aralıkta kayıt yok.",
}: {
  rows: DistributionRow[];
  emptyText?: string;
}) {
  const toplam = rows.reduce((acc, row) => acc + row.count, 0);

  if (toplam === 0) {
    return (
      <p className="py-6 text-[length:var(--text-sm)] text-muted">{emptyText}</p>
    );
  }

  const enBuyuk = Math.max(...rows.map((row) => row.count));

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const oran = Math.round((row.count / toplam) * 100);
        const govde = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[length:var(--text-sm)] text-ink">
                {row.label}
                {row.hint ? (
                  <span className="ms-2 text-[length:var(--text-xs)] text-faint">
                    {row.hint}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[length:var(--text-sm)] text-muted">
                <span className="tabular font-semibold text-ink">{row.count}</span>
                <span className="ms-1.5 tabular text-faint">%{oran}</span>
              </span>
            </span>
            <span
              aria-hidden
              className="mt-1 block h-1.5 bg-inset"
            >
              <span
                className={`block h-full ${TON[row.tone ?? ""] ?? "bg-line-strong"}`}
                style={{ width: `${Math.max(2, (row.count / enBuyuk) * 100)}%` }}
              />
            </span>
          </>
        );

        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className="block rounded-(--radius-xs) py-0.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover"
              >
                {govde}
              </Link>
            ) : (
              <div className="py-0.5">{govde}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
