"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { createOrgUnitAction } from "./actions";
import { emptyOrgFormState, type OrgFormState } from "./form-state";

export interface UnitOption {
  id: string;
  label: string;
}

/**
 * Sonuç mesajı. Kimlikler (`org-hatasi`, `org-basarili`) uçtan uca testlerin
 * tutunduğu yerlerdir; görünüm değişse de korunur.
 */
function Feedback({ state }: { state: OrgFormState }) {
  if (state.error) {
    return (
      <div id="org-hatasi">
        <Alert tone="danger">{state.error}</Alert>
      </div>
    );
  }

  if (state.success) {
    return (
      <div id="org-basarili" role="status">
        <Alert tone="success">{state.success}</Alert>
      </div>
    );
  }

  return null;
}

export function OrgUnitForm({ options }: { options: UnitOption[] }) {
  const [state, formAction, pending] = useActionState(
    createOrgUnitAction,
    emptyOrgFormState,
  );

  const hasRoot = options.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={2}>
        <Field htmlFor="name" label="Birim adı" required>
          <Input id="name" name="name" required placeholder="örn. Kalıphane" />
        </Field>

        <Field
          htmlFor="type"
          label="Kademe"
          hint="Serbest metin; koda gömülü bir hiyerarşi yoktur."
          required
        >
          <Input
            id="type"
            name="type"
            required
            placeholder="Departman, Direktörlük, Genel Müdürlük…"
          />
        </Field>

        <Field htmlFor="parentId" label="Üst birim">
          <Select id="parentId" name="parentId" defaultValue="">
            {/* Ağaçta yalnızca bir kök olabilir; kök varken boş seçenek sunulmaz. */}
            {hasRoot ? null : <option value="">(kök birim)</option>}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor="attentionGroupId"
          label="Dikkat grubu (isteğe bağlı)"
          hint="İleride bir kaydı üst yönetime taşırken, aynı grubu paylaşan birimler tek bir hedef olarak ele alınacak. Şu anki sürümde yalnızca kaydedilir, hiçbir davranışı değiştirmez — boş bırakabilirsiniz."
        >
          <Input
            id="attentionGroupId"
            name="attentionGroupId"
            placeholder="örn. yonetim-kurulu"
          />
        </Field>
      </FormGrid>

      <fieldset className="flex flex-col gap-2.5 rounded-(--radius-sm) border border-line bg-inset/40 p-3.5">
        <legend className="px-1 text-[length:var(--text-sm)] font-medium text-ink">
          Davranış bayrakları
        </legend>
        <p className="text-[length:var(--text-xs)] text-muted">
          Onay akışı çalışıyor; yukarı taşıma Sürüm 2&apos;de devreye girer.
        </p>
        <Checkbox
          name="requiresApproval"
          label="Bu birimdeki faaliyetler onaya tabidir"
          description="Birim yöneticileri kapsam dışıdır: kendi faaliyetleri onaya düşmez, doğrudan üst kademelere akar."
        />
        <Checkbox
          name="autoFlowsUp"
          defaultChecked
          label="Faaliyetler üst kademelere akar"
        />
      </fieldset>

      <FormActions message={<Feedback state={state} />}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Ekleniyor…" : "Birim ekle"}
        </Button>
      </FormActions>
    </form>
  );
}
