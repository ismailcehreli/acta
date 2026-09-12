"use client";

import { useMemo, useState } from "react";

import { useLocale, useTranslations } from "@/components/i18n/provider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import type { TargetOption } from "@/server/activities/target-options";


//



//





function normalize(text: string, locale: string): string {
  return text.toLocaleLowerCase(locale);
}

function DepartmentOption({
  option,
  checked,
  disabled,
  onToggle,
  ownLabel,
}: {
  option: TargetOption;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  ownLabel: string;
}) {
  return (
    <label
      className={[
        "flex items-center gap-2.5 rounded-(--radius-sm) px-2 py-1.5 text-[length:var(--text-sm)]",
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-surface-hover",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(option.id)}
        className="size-4 rounded border-line-strong text-primary"
      />
      <span className="text-ink">{option.name}</span>
      {option.own ? (
        <span className="text-[length:var(--text-xs)] text-muted">
          {ownLabel}
        </span>
      ) : null}
    </label>
  );
}

export function DepartmentPicker({
  options,
  selected,
  onChange,
  max,
}: {
  options: TargetOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [search, setSearch] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const selectedItems = useMemo(
    () =>
      selected
        .map((id) => options.find((option) => option.id === id))
        .filter((option): option is TargetOption => option !== undefined),
    [selected, options],
  );

  const filtered = useMemo(() => {
    const key = normalize(search.trim(), locale);
    if (key === "") return options;
    return options.filter((option) => normalize(option.name, locale).includes(key));
  }, [search, options, locale]);

  const full = selected.length >= max;

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChange(selected.filter((selected) => selected !== id));
      return;
    }


    if (full) return;
    onChange([...selected, id]);
  }

  const ownOptions = filtered.filter((option) => option.own);
  const otherOptions = filtered.filter((option) => !option.own);

  return (
    <div className="flex flex-col gap-2.5" data-test="department-picker">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("departmentPicker.searchPlaceholder")}
          aria-label={t("departmentPicker.searchLabel")}
          className="w-full sm:w-64"
        />
        <span className="text-[length:var(--text-xs)] text-muted tabular">
          {selected.length}/{max}
        </span>
      </div>


      {selectedItems.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-test="selected-departments">
          {selectedItems.map((option) => (
            <Badge key={option.id} tone="primary">
              {option.name}
              <button
                type="button"
                onClick={() => toggle(option.id)}
                aria-label={t("departmentPicker.removeSelection", {
                  name: option.name,
                })}
                className="-mr-0.5 ml-0.5 rounded-full px-1 leading-none hover:bg-primary-line"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-[length:var(--text-sm)] text-muted">
          {t("departmentPicker.noMatch", { query: search })}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {ownOptions.length > 0 ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {ownOptions.map((option) => (
                <DepartmentOption
                  key={option.id}
                  option={option}
                  checked={selectedSet.has(option.id)}
                  disabled={full && !selectedSet.has(option.id)}
                  onToggle={toggle}
                  ownLabel={t("departmentPicker.ownUnit")}
                />
              ))}
            </div>
          ) : null}

          {ownOptions.length > 0 && otherOptions.length > 0 ? (
            <hr className="border-line" />
          ) : null}

          {otherOptions.length > 0 ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {otherOptions.map((option) => (
                <DepartmentOption
                  key={option.id}
                  option={option}
                  checked={selectedSet.has(option.id)}
                  disabled={full && !selectedSet.has(option.id)}
                  onToggle={toggle}
                  ownLabel={t("departmentPicker.ownUnit")}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {full ? (
        <p className="text-[length:var(--text-xs)] text-muted">
          {t("departmentPicker.maxReached", { count: max })}
        </p>
      ) : null}

      {/* Controlled checkboxes mirror their values into the submitted form. */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="targetDepartmentIds" value={id} />
      ))}
    </div>
  );
}
