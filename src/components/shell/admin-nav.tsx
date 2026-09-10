"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Yönetim çalışma alanının ikincil gezinmesi (brief §7).
//
// Yönetim, ana ürünün görsel dilini kullanır ama **ayrı bir çalışma alanı**
// olduğu bellidir: bu şerit yalnız yönetim route'larında görünür ve hepsinde
// aynıdır — kullanıcı bir yönetim ekranından diğerine geçerken nerede
// olduğunu kaybetmez.
//
// Yatay kaydırma dar ekranda bilinçli: yedi bölümü iki satıra sarmak, şeridi
// sayfa başlığından daha yüksek hâle getirirdi.

const BOLUMLER = [
  { href: "/admin/org", label: "Organizasyon" },
  { href: "/admin/users", label: "Kullanıcılar" },
  { href: "/admin/calendar", label: "Çalışma takvimi" },
  { href: "/admin/approval-reasons", label: "Onay gerekçeleri" },
  { href: "/admin/settings", label: "Sistem ayarları" },
  { href: "/admin/jobs", label: "Zamanlanmış işler" },
  { href: "/admin/audit", label: "İşlem kayıtları" },
];

/**
 * Yalnız ana sistem yöneticisine (root) açık bölümler (karar 03.09.2026).
 * Şeritte de yalnız ona görünür: yetkisi olmayanın göreceği bir bağlantı,
 * tıklandığında reddedilmek üzere duran bir bağlantıdır.
 */
const ROOT_BOLUMLERI = [{ href: "/admin/faaliyet-silme", label: "Faaliyet silme" }];

export function AdminNav({ isRoot = false }: { isRoot?: boolean }) {
  const pathname = usePathname();
  const bolumler = isRoot ? [...BOLUMLER, ...ROOT_BOLUMLERI] : BOLUMLER;

  return (
    <nav
      aria-label="Yönetim bölümleri"
      className="-mx-4 border-y border-line bg-raised sm:-mx-7"
    >
      <ul className="flex overflow-x-auto px-4 sm:px-7">
        {bolumler.map((bolum) => {
          const aktif = pathname === bolum.href || pathname.startsWith(`${bolum.href}/`);

          return (
            <li key={bolum.href} className="shrink-0">
              <Link
                href={bolum.href}
                aria-current={aktif ? "page" : undefined}
                className={[
                  "relative flex min-h-(--spacing-touch) items-center px-3.5",
                  "text-[length:var(--text-sm)] transition-colors duration-(--duration-fast)",
                  aktif
                    ? "font-semibold text-ink"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {bolum.label}
                {/* Aktif bölüm alt kuralla da işaretlenir: renk tek taşıyıcı
                    değil. */}
                {aktif ? (
                  <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-primary" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
