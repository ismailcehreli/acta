import Link from "next/link";

// Numaralı sayfalama.
//
// Yalnız **durağan** listelerde kullanılır: kişinin kendi arşivi gibi, araya
// başkasının kaydının girmediği yerlerde. Canlı akışta (kapsam akışı) offset
// sayfalama satır atlar ya da tekrarlar; orası imleçle sayfalanıyor.
//
// Sayfa numaraları kısaltılır: 200 sayfalık bir listede 200 bağlantı basmak
// hem ekranı hem ekran okuyucuyu boğar. Kenarlar ve şu anki sayfanın komşuları
// gösterilir, arası "…" olur.

function sayfaListesi(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const parcalar: (number | "...")[] = [1];
  const bas = Math.max(2, current - 1);
  const son = Math.min(total - 1, current + 1);

  if (bas > 2) parcalar.push("...");
  for (let i = bas; i <= son; i += 1) parcalar.push(i);
  if (son < total - 1) parcalar.push("...");

  parcalar.push(total);
  return parcalar;
}

export function Pagination({
  page,
  pageCount,
  hrefFor,
  totalLabel,
}: {
  /** 1'den başlar. */
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** "312 kayıt" gibi; sağda durur. */
  totalLabel?: string;
}) {
  if (pageCount <= 1) {
    return totalLabel ? (
      <div className="border-t border-line px-4 py-3 text-[length:var(--text-xs)] text-faint sm:px-5">
        {totalLabel}
      </div>
    ) : null;
  }

  const sayfalar = sayfaListesi(page, pageCount);

  return (
    <nav
      aria-label="Sayfalama"
      className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-line px-4 py-3 sm:px-5"
    >
      <Adim href={page > 1 ? hrefFor(page - 1) : null} label="Önceki sayfa">
        ‹
      </Adim>

      <ul className="flex flex-wrap items-center gap-1">
        {sayfalar.map((deger, i) =>
          deger === "..." ? (
            <li
              key={`bosluk-${i}`}
              aria-hidden
              className="px-1 text-[length:var(--text-sm)] text-faint"
            >
              …
            </li>
          ) : (
            <li key={deger}>
              <Link
                href={hrefFor(deger)}
                aria-current={deger === page ? "page" : undefined}
                aria-label={`Sayfa ${deger}`}
                className={[
                  "flex min-h-9 min-w-9 items-center justify-center rounded-(--radius-xs) px-2",
                  "tabular text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
                  deger === page
                    ? "bg-primary font-semibold text-white"
                    : "text-muted hover:bg-surface-hover hover:text-ink",
                ].join(" ")}
              >
                {deger}
              </Link>
            </li>
          ),
        )}
      </ul>

      <Adim href={page < pageCount ? hrefFor(page + 1) : null} label="Sonraki sayfa">
        ›
      </Adim>

      {totalLabel ? (
        <span className="ms-auto text-[length:var(--text-xs)] text-faint">
          {totalLabel}
        </span>
      ) : null}
    </nav>
  );
}

/** Önceki/sonraki oku. Kapalıyken bağlantı değil, gri bir işaret. */
function Adim({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const taban =
    "flex min-h-9 min-w-9 items-center justify-center rounded-(--radius-xs) text-[length:var(--text-base)]";

  if (!href) {
    return (
      <span aria-hidden className={`${taban} text-line-strong`}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={`${taban} text-muted transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-ink`}
    >
      <span aria-hidden>{children}</span>
    </Link>
  );
}
