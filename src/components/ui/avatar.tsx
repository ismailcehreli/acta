import { avatarToneIndex } from "@/shared/format/avatar-tone";
import { initials } from "@/shared/format/avatar-initials";

// Profil resmi rozeti (Görev 11.5).
//
// **Tek bileşen, boyut bir özellik.** Dokuz ayrı yerde gösteriliyor; her biri
// için ayrı bileşen yazmak, birinde düzeltilen bir hatanın diğer sekizinde
// kalması demekti.
//
// Resim yoksa baş harfler düşer. Renk kişinin kimliğinden türetilir ve
// değişmez: aynı kişi her ekranda aynı renkte görünür, göz onu bir işaret
// olarak kullanabilir.

const TONLAR = [
  "bg-avatar-0",
  "bg-avatar-1",
  "bg-avatar-2",
  "bg-avatar-3",
  "bg-avatar-4",
  "bg-avatar-5",
] as const;

export interface AvatarUser {
  id: string;
  fullName: string;
  /** Doluysa resim gösterilir; boşsa baş harfler. */
  avatarExtension?: string | null;
}

export function Avatar({
  user,
  size = 32,
  className = "",
  cacheKey,
}: {
  user: AvatarUser;
  /** Kenar uzunluğu (px). Liste satırında 24–32, profilde 96. */
  size?: number;
  className?: string;
  /**
   * Adres değişmediği hâlde resmin değiştiği yerlerde (kendi profilinde
   * yükleme yaptıktan hemen sonra) tarayıcının elindeki kopyayı bırakması
   * için. Listelerde gerekmez; orada koşullu istek yeterli.
   */
  cacheKey?: string;
}) {
  const kenar = { width: size, height: size };
  const ortak = `shrink-0 rounded-full object-cover ${className}`;

  if (user.avatarExtension) {
    return (
      // `next/image` kullanılmıyor: kaynak yetki kontrollü kendi uç
      // noktamız ve boyutlar zaten sabit; araya bir görüntü iyileştirici
      // koymak, özel önbellek başlığını da dolaşmak demekti.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/users/${user.id}/avatar${cacheKey ? `?v=${cacheKey}` : ""}`}
        alt=""
        aria-hidden
        style={kenar}
        className={`${ortak} bg-inset`}
        loading="lazy"
        decoding="async"
      />
    );
  }

  const harfler = initials(user.fullName);
  const ton = TONLAR[avatarToneIndex(user.id)] ?? TONLAR[0];

  return (
    <span
      aria-hidden
      style={{ ...kenar, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={`grid place-items-center font-semibold text-white ${ton} ${ortak}`}
    >
      {harfler || "?"}
    </span>
  );
}
