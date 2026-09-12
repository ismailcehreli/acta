import type { ReactNode } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";

import { PageSizeSelect } from "./page-size-select";
import { getTranslations } from "@/server/i18n/server";


//




//



//



export interface FilterFieldOption {
  value: string;
  label: string;
}

export interface FilterField {

  name: string;
  label: string;

  value: string;
  options: FilterFieldOption[];

  width?: string;
}

export async function FilterBar({
  action,
  fields,
  hidden,
  extra,
  pageSize,
  clearHref,
  filtered,
  submitLabel,
}: {

  action?: string;
  fields: FilterField[];

  hidden?: { name: string; value: string }[];

  extra?: ReactNode;

  pageSize?: number;
  clearHref: string;

  filtered: boolean;
  submitLabel?: string;
}) {
  const t = await getTranslations();
  return (
    <div className="border-b border-line bg-inset/60 px-4 py-3 sm:px-5">
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">

        {hidden?.map((field) => (
          <input key={field.name} type="hidden" name={field.name} value={field.value} />
        ))}

        {extra}

        {fields.map((field) => (
          <Field
            key={field.name}
            htmlFor={field.name}
            label={field.label}
            className={field.width ?? "w-44"}
          >

            <Select
              key={field.value}
              id={field.name}
              name={field.name}
              defaultValue={field.value}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}

        {pageSize !== undefined ? <PageSizeSelect value={pageSize} /> : null}

        <Button type="submit" size="sm">
          {submitLabel ?? t("common.apply")}
        </Button>

        {filtered ? (
          <ButtonLink href={clearHref} variant="ghost" size="sm">
            {t("common.clearFilter")}
          </ButtonLink>
        ) : null}
      </form>
    </div>
  );
}
