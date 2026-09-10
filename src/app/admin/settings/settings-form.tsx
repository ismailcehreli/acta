"use client";

import { useActionState, useEffect, useState } from "react";

import {
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  type SettingDefinition,
} from "@/server/settings/registry";
import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";
import { ScorePolicy } from "@/components/scoring/score-policy";

import { saveSettingsAction } from "./actions";
import { emptySettingsFormState } from "./form-state";
import type { SettingsSectionSlug } from "./settings-sections";

// Sistem ayarları ekranı (§16.5). Amaç işletimseldir: "üç iş günü cevapsızsa
// hatırlat" bugün üç, yarın bir olabilir; bunu değiştirmek için kod okumak ve
// sürüm çıkarmak gerekmemeli.
//
// Her ayar bir satırdır: solda ne olduğu ve neden var olduğu, sağda değeri.
// Açıklamayı alanın altına koymak, uzun listede değerleri birbirinden
// uzaklaştırıp taramayı zorlaştırıyordu.

function SettingRow({
  definition,
  value,
}: {
  definition: SettingDefinition;
  value: string;
}) {
  if (definition.type === "boolean") {
    return (
      <div className="py-3.5">
        <Checkbox
          name={definition.key}
          defaultChecked={value === "true"}
          label={definition.label}
          description={definition.description}
        />
      </div>
    );
  }

  // Alan adı listesi geniş bir metin alanıdır; sayı kutusunun dar düzeni
  // buraya uymuyor.
  if (definition.type === "domains") {
    return (
      <div className="flex flex-col gap-2 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{definition.label}</p>
          <p className="mt-0.5 text-sm text-muted">{definition.description}</p>
        </div>
        <Input
          type="text"
          name={definition.key}
          defaultValue={value}
          placeholder={definition.placeholder}
          aria-label={definition.label}
          className="w-full"
        />
      </div>
    );
  }

  if (definition.type === "select") {
    return (
      <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 sm:max-w-xl">
          <p className="text-sm font-medium text-ink">{definition.label}</p>
          <p className="mt-0.5 text-sm text-muted">{definition.description}</p>
        </div>
        <Select
          name={definition.key}
          defaultValue={value}
          aria-label={definition.label}
          className="w-full shrink-0 sm:w-56"
        >
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:max-w-xl">
        <p className="text-sm font-medium text-ink">{definition.label}</p>
        <p className="mt-0.5 text-sm text-muted">{definition.description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Input
          type="number"
          name={definition.key}
          defaultValue={value}
          min={definition.min}
          max={definition.max}
          step={1}
          aria-label={definition.label}
          className="w-28 text-right tabular"
        />
        {definition.unit ? (
          <span className="w-16 text-sm text-muted">{definition.unit}</span>
        ) : (
          <span className="w-16" />
        )}
      </div>
    </div>
  );
}

export function SettingsForm({
  values,
  section,
}: {
  values: Record<string, string>;
  section: SettingsSectionSlug;
}) {
  const [state, formAction, pending] = useActionState(
    saveSettingsAction,
    emptySettingsFormState,
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="section" value={section} />
      {SETTING_GROUPS.filter((group) =>
        SETTING_DEFINITIONS.some(
          (definition) => definition.group === group && definitionGroupBelongsToSection(definition.group, section),
        ),
      ).map((group) => {
        const alanlar = SETTING_DEFINITIONS.filter(
          (definition) =>
            definition.group === group &&
            definitionGroupBelongsToSection(definition.group, section),
        );
        if (alanlar.length === 0) return null;

        return (
          <Card
            key={group}
            id={
              group === "Onay akışı"
                ? "ayar-onay-akisi"
                : group === "Soru–cevap"
                  ? "ayar-soru-cevap"
                  : group === "Takip maddeleri"
                    ? "ayar-takip-maddeleri"
                    : undefined
            }
          >
            <CardHeader title={group} />
            <CardBody className="divide-y divide-line py-0">
              {alanlar.map((definition) => (
                <SettingRow
                  key={definition.key}
                  definition={definition}
                  value={values[definition.key] ?? definition.defaultValue}
                />
              ))}
              {group === "Skor" ? <ScorePolicy values={values} /> : null}
            </CardBody>
          </Card>
        );
      })}

      <FormActions
        message={
          state.error || state.success || dirty ? (
            <div className="flex flex-col gap-2">
              <FormMessage error={state.error} success={state.success} />
              {dirty ? (
                <p className="text-[length:var(--text-xs)] text-muted" role="status">
                  Kaydedilmemiş değişiklikler var.
                </p>
              ) : null}
            </div>
          ) : undefined
        }
      >
        <Button type="submit" variant="primary" disabled={pending}>
          Ayarları kaydet
        </Button>
      </FormActions>
    </form>
  );
}

function definitionGroupBelongsToSection(
  group: string,
  section: SettingsSectionSlug,
): boolean {
  switch (section) {
    case "general":
      return group === "Faaliyet girişi" || group === "İzin ve faaliyet dışı günler";
    case "approval":
      return (
        group === "Onay akışı" ||
        group === "Soru–cevap" ||
        group === "Takip maddeleri"
      );
    case "notifications":
      return group === "Bildirimler";
    case "scoring":
      return group === "Skor";
    case "accounts":
      return group === "Kullanıcı hesapları" || group === "Oturum ve güvenlik";
    case "files":
      return group === "Dosya ekleri";
    default:
      return false;
  }
}
