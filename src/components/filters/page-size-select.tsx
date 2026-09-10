"use client";

import { useId } from "react";

import { Field, Select } from "@/components/ui/form";
import { PAGE_SIZES, PAGE_SIZE_COOKIE } from "@/shared/page-size";

// "Sayfada kaç kayıt" seçici.
//
// Seçim yapıldığı anda uygulanır — kullanıcı ayrıca "Uygula"ya basmak zorunda
// değil. Aynı anda çereze de yazılır; tercih diğer listelerde ve sonraki
// oturumlarda hatırlanır.
//
// Çerez **istemcide** yazılıyor: bu bir ekran tercihi, güvenlikle ilgisi yok
// ve sunucuya ayrı bir tur attırmak için sebep yok. Sunucu yine de gelen
// değeri izinli listeye indirgiyor; buradaki yazma bir kolaylık, kaynak
// doğrulama değil.

const BIR_YIL = 60 * 60 * 24 * 365;

export function PageSizeSelect({ value }: { value: number }) {
  const id = useId();

  return (
    <Field htmlFor={id} label="Sayfada" className="w-28">
      <Select
        key={value}
        id={id}
        name="boyut"
        defaultValue={String(value)}
        onChange={(olay) => {
          document.cookie = `${PAGE_SIZE_COOKIE}=${olay.target.value}; path=/; max-age=${BIR_YIL}; samesite=lax`;
          olay.target.form?.requestSubmit();
        }}
      >
        {PAGE_SIZES.map((boyut) => (
          <option key={boyut} value={boyut}>
            {boyut}
          </option>
        ))}
      </Select>
    </Field>
  );
}
