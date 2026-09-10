import { PageSizeSelect } from "./page-size-select";

// Süzgeç satırı olmayan listelerde tek başına "sayfada kaç kayıt" seçicisi.
//
// GET formu: seçim adres çubuğuna yazılır, sunucu onu izinli değere indirger
// ve aynı anda çereze de yazılır — tercih diğer listelerde de hatırlanır.
// Sayfa numarası bilerek taşınmaz: boyut değişince satırlar kayar ve eski
// numara başka bir yere denk gelir; başa dönmek doğru davranıştır.

export function PageSizeForm({
  action,
  value,
}: {
  action: string;
  value: number;
}) {
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      <PageSizeSelect value={value} />
      <noscript>
        <button
          type="submit"
          className="mb-0.5 rounded-(--radius-xs) border border-line-strong px-2.5 py-1.5 text-[length:var(--text-xs)] text-ink"
        >
          Uygula
        </button>
      </noscript>
    </form>
  );
}
