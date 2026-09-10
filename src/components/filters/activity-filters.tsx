import type { ReactNode } from "react";

import { Field, Input } from "@/components/ui/form";

import { DONEM_SECENEKLERI, FilterBar } from "./filter-bar";

// Faaliyet süzgeci: kapsam akışı ve aramanın paylaştığı dört alan (Görev 10.9).
//
// Şeridin kendisi `FilterBar`dan gelir (Görev 11.3); burada yalnız **hangi
// alanlar** olduğu tanımlanır. Diğer listeler kendi alanlarını aynı şeride
// veriyor — böylece her ekran aynı düzeni ve aynı adres sözleşmesini
// kullanıyor.
//
// Aynı süzgeç hem kapsam akışında hem aramada kullanılıyor. Aramaya ikinci bir
// süzgeç seti yazmak, iki ayrı mantık demekti: biri bozulduğunda diğeri fark
// edilmezdi ve kullanıcı iki farklı davranış öğrenmek zorunda kalırdı.
//
// **Süzgeç yetki vermez.** Daraltma her zaman görünürlük süzgecinin *üstüne*
// uygulanır; hiçbir alan kapsamı genişletemez.

export interface FilterOptions {
  people: { id: string; fullName: string }[];
  departments: { id: string; name: string }[];
}

export interface FilterValues {
  period: string;
  authorId: string;
  authorOrgUnitId: string;
  targetOrgUnitId: string;
}

export const EMPTY_FILTERS: FilterValues = {
  period: "week",
  authorId: "",
  authorOrgUnitId: "",
  targetOrgUnitId: "",
};

/** Varsayılandan sapan bir seçim var mı; "temizle" düğmesi buna bağlı. */
export function isFiltered(
  selected: FilterValues,
  defaultPeriod = "week",
  unreadOnly = false,
): boolean {
  return (
    selected.authorId !== "" ||
    selected.authorOrgUnitId !== "" ||
    selected.targetOrgUnitId !== "" ||
    selected.period !== defaultPeriod ||
    unreadOnly
  );
}

/**
 * Süzgeç satırı.
 *
 * Kutuların `key`i seçili değerdir. Sebep: `defaultValue` yalnız **bağlanma
 * anında** DOM'a yazılır; yumuşak gezinmede React aynı `<select>` düğümünü
 * yeniden kullanıyor ve kutu eski değerde kalıyordu — liste daralmış, süzgeç
 * "Hepsi" görünüyordu.
 */
export function ActivityFilters({
  action,
  options,
  selected,
  clearHref,
  defaultPeriod = "week",
  unreadOnly = false,
  hidden,
  extra,
  pageSize,
  submitLabel = "Uygula",
}: {
  /** Formun gideceği yol; boşsa aynı sayfa. */
  action?: string;
  options: FilterOptions;
  selected: FilterValues;
  clearHref: string;
  defaultPeriod?: string;
  /** Formla birlikte taşınması gereken alanlar (arama kelimesi gibi). */
  hidden?: { name: string; value: string }[];
  /** Sayfaya özel ek alan. */
  extra?: ReactNode;
  /** Yalnız okunmamış kayıtlar gösteriliyorsa temizleme durumuna katılır. */
  unreadOnly?: boolean;
  /** Sayfada kaç kayıt gösterileceği; verilirse seçici çizilir. */
  pageSize?: number;
  /** Gönder düğmesinin metni; arama sayfasında "Ara" olur. */
  submitLabel?: string;
}) {
  const departmanSecenekleri = [
    { value: "", label: "Hepsi" },
    ...options.departments.map((unit) => ({ value: unit.id, label: unit.name })),
  ];

  return (
    <FilterBar
      action={action}
      clearHref={clearHref}
      filtered={isFiltered(selected, defaultPeriod, unreadOnly)}
      hidden={hidden}
      extra={extra}
      pageSize={pageSize}
      submitLabel={submitLabel}
      fields={[
        {
          name: "period",
          label: "Dönem",
          value: selected.period,
          width: "w-32",
          options: DONEM_SECENEKLERI,
        },
        {
          name: "authorId",
          label: "Kişi",
          value: selected.authorId,
          options: [
            { value: "", label: "Herkes" },
            ...options.people.map((person) => ({
              value: person.id,
              label: person.fullName,
            })),
          ],
        },
        {
          name: "authorOrgUnitId",
          label: "Yazan departman",
          value: selected.authorOrgUnitId,
          width: "w-52",
          options: departmanSecenekleri,
        },
        {
          name: "targetOrgUnitId",
          label: "İlgili departman",
          value: selected.targetOrgUnitId,
          width: "w-52",
          options: departmanSecenekleri,
        },
      ]}
    />
  );
}

/** Arama kutusu; süzgeç satırının başına eklenir. */
export function SearchField({
  value,
  label = "Ara",
  placeholder = "Kelime ya da faaliyet no",
}: {
  value: string;
  /** Arama kutusunun etiketi; sayfaya göre ne aradığını söyler. */
  label?: string;
  placeholder?: string;
}) {
  return (
    <Field htmlFor="q" label={label} className="w-64">
      <Input
        key={value}
        id="q"
        name="q"
        type="search"
        defaultValue={value}
        placeholder={placeholder}
      />
    </Field>
  );
}
