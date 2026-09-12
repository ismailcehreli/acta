"use client";

import { useId } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Field, Select } from "@/components/ui/form";
import { PAGE_SIZES, PAGE_SIZE_COOKIE } from "@/shared/page-size";


//



//





const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function PageSizeSelect({ value }: { value: number }) {
  const t = useTranslations();
  const id = useId();

  return (
    <Field htmlFor={id} label={t("common.pageSize")} className="w-28">
      <Select
        key={value}
        id={id}
        name="pageSize"
        defaultValue={String(value)}
        onChange={(event) => {
          document.cookie = `${PAGE_SIZE_COOKIE}=${event.target.value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
          event.target.form?.requestSubmit();
        }}
      >
        {PAGE_SIZES.map((pageSize) => (
          <option key={pageSize} value={pageSize}>
            {pageSize}
          </option>
        ))}
      </Select>
    </Field>
  );
}
