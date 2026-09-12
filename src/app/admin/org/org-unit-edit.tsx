"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import { useTranslations } from "@/components/i18n/provider";

import { updateOrgUnitAction } from "./actions";
import { emptyOrgFormState } from "./form-state";
import { OrgUnitActions } from "./org-unit-actions";
import type { UnitOption } from "./org-form";
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
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateOrgUnitAction,
    emptyOrgFormState,
  );
  const nameId = `edit-name-${unit.id}`;
  const levelId = `edit-level-${unit.id}`;
  const attentionGroupId = `edit-attention-group-${unit.id}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
        >
          {open ? t("screens.organization.close") : t("screens.organization.edit")}
        </Button>

        <OrgUnitActions
          unitId={unit.id}
          unitName={unit.name}
          options={options}
        />
      </div>

      {/* Keep the editor on its own full-width row below the action buttons. */}
      {open ? (
      <form
        action={formAction}
        data-test={`organization-edit-${unit.id}`}
        className="mt-3 w-full rounded-(--radius-sm) border border-line bg-inset/40 p-4"
      >
        <input type="hidden" name="id" value={unit.id} />

        <FormGrid columns={2}>
          <Field htmlFor={nameId} label={t("screens.organization.unitName")} required>
            <Input id={nameId} name="name" defaultValue={unit.name} required />
          </Field>

          <Field htmlFor={levelId} label={t("screens.organization.level")} required>
            <Input id={levelId} name="type" defaultValue={unit.type} required />
          </Field>

          <Field
            htmlFor={attentionGroupId}
            label={t("screens.organization.attentionGroup")}
            className="sm:col-span-2"
          >
            <Input
              id={attentionGroupId}
              name="attentionGroupId"
              defaultValue={unit.attentionGroupId ?? ""}
              placeholder={t("screens.organization.attentionGroupPlaceholder")}
            />
          </Field>
        </FormGrid>

        <fieldset className="mt-4 flex flex-col gap-2.5">
          <legend className="text-[length:var(--text-sm)] font-medium text-ink">
            {t("screens.organization.behaviorFlags")}
          </legend>
          {/* Changes affect future activities only; historical records remain unchanged. */}
          <p className="text-[length:var(--text-xs)] text-muted">
            {t("screens.organization.historyUnaffected")}
          </p>
          <Checkbox
            name="requiresApproval"
            defaultChecked={unit.requiresApproval}
            label={t("screens.organization.requiresApproval")}
            description={t("screens.organization.requiresApprovalDescription")}
          />
          <Checkbox
            name="autoFlowsUp"
            defaultChecked={unit.autoFlowsUp}
            label={t("screens.organization.flowsUp")}
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
            {pending
              ? t("screens.organization.saving")
              : t("screens.organization.saveChanges")}
          </Button>
        </FormActions>
      </form>
      ) : null}
    </>
  );
}
