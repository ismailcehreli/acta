"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import { useTranslations } from "@/components/i18n/provider";

import { createOrgUnitAction } from "./actions";
import { emptyOrgFormState, type OrgFormState } from "./form-state";

export interface UnitOption {
  id: string;
  label: string;
}
function Feedback({ state }: { state: OrgFormState }) {
  if (state.error) {
    return (
      <div id="organization-error">
        <Alert tone="danger">{state.error}</Alert>
      </div>
    );
  }

  if (state.success) {
    return (
      <div id="organization-success" role="status">
        <Alert tone="success">{state.success}</Alert>
      </div>
    );
  }

  return null;
}

export function OrgUnitForm({ options }: { options: UnitOption[] }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    createOrgUnitAction,
    emptyOrgFormState,
  );

  const hasRoot = options.length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormGrid columns={2}>
        <Field htmlFor="name" label={t("screens.organization.unitName")} required>
          <Input
            id="name"
            name="name"
            required
            placeholder={t("screens.organization.unitNamePlaceholder")}
          />
        </Field>

        <Field
          htmlFor="type"
          label={t("screens.organization.level")}
          hint={t("screens.organization.levelHint")}
          required
        >
          <Input
            id="type"
            name="type"
            required
            placeholder={t("screens.organization.levelPlaceholder")}
          />
        </Field>

        <Field htmlFor="parentId" label={t("screens.organization.parentUnit")}>
          <Select id="parentId" name="parentId" defaultValue="">
            {hasRoot ? null : (
              <option value="">{t("screens.organization.rootUnit")}</option>
            )}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor="attentionGroupId"
          label={t("screens.organization.attentionGroup")}
          hint={t("screens.organization.attentionGroupHint")}
        >
          <Input
            id="attentionGroupId"
            name="attentionGroupId"
            placeholder={t("screens.organization.attentionGroupPlaceholder")}
          />
        </Field>
      </FormGrid>

      <fieldset className="flex flex-col gap-2.5 rounded-(--radius-sm) border border-line bg-inset/40 p-3.5">
        <legend className="px-1 text-[length:var(--text-sm)] font-medium text-ink">
          {t("screens.organization.behaviorFlags")}
        </legend>
        <p className="text-[length:var(--text-xs)] text-muted">
          {t("screens.organization.approvalFlowHint")}
        </p>
        <Checkbox
          name="requiresApproval"
          label={t("screens.organization.requiresApproval")}
          description={t("screens.organization.requiresApprovalDescription")}
        />
        <Checkbox
          name="autoFlowsUp"
          defaultChecked
          label={t("screens.organization.flowsUp")}
        />
      </fieldset>

      <FormActions message={<Feedback state={state} />}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("screens.organization.adding")
            : t("screens.organization.addUnit")}
        </Button>
      </FormActions>
    </form>
  );
}
