"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { updateOrgUnitAction } from "./actions";
import { emptyOrgFormState } from "./form-state";
import { OrgUnitActions } from "./org-unit-actions";
import type { UnitOption } from "./org-form";

// Birim düzenleme (§4.3). Sistem yöneticisi birimin adını, kademesini, dikkat
// grubunu ve iki davranış bayrağını düzeltebilir.
//
// Form satırın **altında** açılıyor: ayrı bir sayfaya gitmek, ağaçtaki yerini
// görerek düzenlemeyi imkânsız kılardı. Bu yüzden bileşen satırın işlem
// kümesini de kendisi basıyor — açık/kapalı durumu düğmeyle formun ortak
// verisi ve ikisi aynı bileşende durmak zorunda.

export interface EditableUnit {
  id: string;
  name: string;
  type: string;
  requiresApproval: boolean;
  autoFlowsUp: boolean;
  attentionGroupId: string | null;
}

export function OrgUnitEdit({
  unit,
  options,
}: {
  unit: EditableUnit;
  options: UnitOption[];
}) {
  const [acik, setAcik] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateOrgUnitAction,
    emptyOrgFormState,
  );

  // Alan kimlikleri birim başına benzersiz: ağaçta aynı anda birden fazla form
  // açık olabilir ve tekrar eden `id` etiketi yanlış kontrole bağlardı.
  const ad = `duzenle-ad-${unit.id}`;
  const kademe = `duzenle-kademe-${unit.id}`;
  const grup = `duzenle-grup-${unit.id}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => setAcik((onceki) => !onceki)}
          aria-expanded={acik}
        >
          {acik ? "Kapat" : "Düzenle"}
        </Button>

        <OrgUnitActions
          unitId={unit.id}
          unitName={unit.name}
          options={options}
        />
      </div>

      {/* `w-full`: satır sarmalayan bir flex kabı; form kendi satırına düşüp
          tam genişlikte açılsın diye. */}
      {acik ? (
      <form
        action={formAction}
        data-test={`birim-duzenle-${unit.id}`}
        className="mt-3 w-full rounded-(--radius-sm) border border-line bg-inset/40 p-4"
      >
        <input type="hidden" name="id" value={unit.id} />

        <FormGrid columns={2}>
          <Field htmlFor={ad} label="Birim adı" required>
            <Input id={ad} name="name" defaultValue={unit.name} required />
          </Field>

          <Field htmlFor={kademe} label="Kademe" required>
            <Input id={kademe} name="type" defaultValue={unit.type} required />
          </Field>

          <Field
            htmlFor={grup}
            label="Dikkat grubu (isteğe bağlı)"
            className="sm:col-span-2"
          >
            <Input
              id={grup}
              name="attentionGroupId"
              defaultValue={unit.attentionGroupId ?? ""}
              placeholder="örn. yonetim-kurulu"
            />
          </Field>
        </FormGrid>

        <fieldset className="mt-4 flex flex-col gap-2.5">
          <legend className="text-[length:var(--text-sm)] font-medium text-ink">
            Davranış bayrakları
          </legend>
          {/* Değişiklik yalnızca bundan sonra yazılacak faaliyetleri etkiler;
              geçmiş kayıtların durumu olduğu gibi kalır. */}
          <p className="text-[length:var(--text-xs)] text-muted">
            Değişiklik geçmişe etki etmez: daha önce yazılmış faaliyetlerin
            durumu değişmez.
          </p>
          <Checkbox
            name="requiresApproval"
            defaultChecked={unit.requiresApproval}
            label="Bu birimdeki faaliyetler onaya tabidir"
            description="Birim yöneticileri kapsam dışıdır: kendi faaliyetleri onaya düşmez, doğrudan üst kademelere akar."
          />
          <Checkbox
            name="autoFlowsUp"
            defaultChecked={unit.autoFlowsUp}
            label="Faaliyetler üst kademelere akar"
          />
        </fieldset>

        <FormActions
          message={
            state.error ? (
              <Alert tone="danger">{state.error}</Alert>
            ) : state.success ? (
              <Alert tone="success">{state.success}</Alert>
            ) : null
          }
        >
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
          </Button>
        </FormActions>
      </form>
      ) : null}
    </>
  );
}
