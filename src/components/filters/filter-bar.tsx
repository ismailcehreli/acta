import type { ReactNode } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";

import { PageSizeSelect } from "./page-size-select";

// Ortak süzgeç şeridi (Görev 11.3).
//
// Her listeleyen sayfa kendi daraltmalarını tanımlar; **görsel dil ve adres
// çubuğu sözleşmesi ortaktır.** Sayfa başına ayrı süzgeç bileşeni yazmak iki
// şeyi bozardı: kullanıcı her ekranda yeni bir düzen öğrenirdi ve biri
// düzeltildiğinde diğerleri sessizce geride kalırdı.
//
// **Süzgeç yetki vermez.** Alanlar yalnız adres çubuğuna yazılır; daraltmayı
// sunucu, görünürlük filtresinin *üstüne* uygular ve hiçbiri kapsamı
// genişletemez (§8.4).
//
// Form `method="get"`: süzgeçli liste paylaşılabilir bir adrestir, geri
// düğmesi çalışır ve sayfa yenilendiğinde seçim kaybolmaz.

export interface FilterFieldOption {
  value: string;
  label: string;
}

export interface FilterField {
  /** Adres çubuğundaki parametre adı. */
  name: string;
  label: string;
  /** Seçili değer; boş metin "hepsi" demektir. */
  value: string;
  options: FilterFieldOption[];
  /** Tailwind genişlik sınıfı; alan içeriğine göre ayarlanır. */
  width?: string;
}

export function FilterBar({
  action,
  fields,
  hidden,
  extra,
  pageSize,
  clearHref,
  filtered,
  submitLabel = "Uygula",
}: {
  /** Formun gideceği yol; boşsa aynı sayfa. */
  action?: string;
  fields: FilterField[];
  /** Formla birlikte taşınması gereken alanlar (arama kelimesi gibi). */
  hidden?: { name: string; value: string }[];
  /** Sayfaya özel ek alan; alanların önüne girer. */
  extra?: ReactNode;
  /** Verilirse "sayfada kaç kayıt" seçicisi çizilir. */
  pageSize?: number;
  clearHref: string;
  /** Varsayılandan sapan bir seçim var mı; "temizle" düğmesi buna bağlı. */
  filtered: boolean;
  submitLabel?: string;
}) {
  return (
    <div className="border-b border-line bg-inset/60 px-4 py-3 sm:px-5">
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        {/* Gizli alanlar olmadan süzgeç uygulandığında arama kelimesi
            kayboluyor ve kullanıcı bomboş bir sonuç sayfasına düşüyordu. */}
        {hidden?.map((alan) => (
          <input key={alan.name} type="hidden" name={alan.name} value={alan.value} />
        ))}

        {extra}

        {fields.map((alan) => (
          <Field
            key={alan.name}
            htmlFor={alan.name}
            label={alan.label}
            className={alan.width ?? "w-44"}
          >
            {/* `key` seçili değerdir: `defaultValue` yalnız bağlanma anında
                DOM'a yazılır ve yumuşak gezinmede React aynı `<select>`
                düğümünü yeniden kullanıyor; kutu eski değerde kalıyor,
                liste daralmışken süzgeç "Hepsi" görünüyordu. */}
            <Select
              key={alan.value}
              id={alan.name}
              name={alan.name}
              defaultValue={alan.value}
            >
              {alan.options.map((secenek) => (
                <option key={secenek.value} value={secenek.value}>
                  {secenek.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}

        {pageSize !== undefined ? <PageSizeSelect value={pageSize} /> : null}

        <Button type="submit" size="sm">
          {submitLabel}
        </Button>

        {filtered ? (
          <ButtonLink href={clearHref} variant="ghost" size="sm">
            Süzgeci temizle
          </ButtonLink>
        ) : null}
      </form>
    </div>
  );
}

/** Listelerde ortak kullanılan dönem seçenekleri. */
export const DONEM_SECENEKLERI: FilterFieldOption[] = [
  { value: "today", label: "Bugün" },
  { value: "week", label: "Bu hafta" },
  { value: "all", label: "Tümü" },
];
