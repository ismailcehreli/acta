"use client";

import { useActionState } from "react";
import { useTranslations } from "@/components/i18n";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { createUserAction } from "./actions";
import { emptyUserFormState } from "./form-state";




export interface UnitChoice {
  id: string;
  label: string;
}

export function UserForm({
  units,
  isSystemAdmin,
}: {
  units: UnitChoice[];
  isSystemAdmin: boolean;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    createUserAction,
    emptyUserFormState,
  );

  return (
    <Card>
      <CardHeader
        title={t("screens.users.newUser")}
        description={t("screens.users.createDescription")}
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid>
            <Field htmlFor="fullName" label={t("screens.users.fullName")} required>
              <Input id="fullName" name="fullName" required autoComplete="off" />
            </Field>

            <Field
              htmlFor="title"
              label={t("screens.users.jobTitle")}
              hint={t("screens.users.jobTitleHint")}
            >
              <Input
                id="title"
                name="title"
                autoComplete="off"
                maxLength={100}
                placeholder={t("screens.users.jobTitlePlaceholder")}
              />
            </Field>

            <Field htmlFor="email" label={t("common.email")} required>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="off"
              />
            </Field>

            <Field htmlFor="orgUnitId" label={t("screens.users.unit")} required>
              <Select id="orgUnitId" name="orgUnitId" required defaultValue="">
                <option value="" disabled>
                  {t("screens.users.selectUnit")}
                </option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </Field>


            {isSystemAdmin ? (
              <Field htmlFor="initialPassword" label={t("screens.users.initialPassword")} required hint={t("screens.users.passwordHint")}>
                <Input
                  id="initialPassword"
                  name="initialPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </Field>
            ) : null}
          </FormGrid>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-ink">{t("screens.users.rolesSection")}</legend>
            {isSystemAdmin ? (
              <>
                <Checkbox
                  name="isUnitManager"
                  label={t("screens.users.unitManager")}
                  description={t("screens.users.unitManagerDescription")}
                />
                <Checkbox
                  name="isSystemAdmin"
                  label={t("screens.users.systemAdministrator")}
                  description={t("screens.users.systemAdministratorDescription")}
                />
              </>
            ) : (
              <p className="text-[length:var(--text-sm)] text-muted">
                {t("screens.users.onlyAdministratorCanGrant")}
              </p>
            )}
            {isSystemAdmin ? (
              <>
                <Checkbox
                  name="isScored"
                  defaultChecked
                  label={t("screens.users.includeInScoring")}
                  description={t("screens.users.scoringDescription")}
                />
                <Checkbox
                  name="canAppreciate"
                  label={t("screens.users.canAppreciate")}
                  description={t("screens.users.recognitionDescription")}
                />
                <Checkbox
                  name="canViewReports"
                  label={t("screens.users.canViewReports")}
                  description={t("screens.users.managementReportsDescription")}
                />
                <Checkbox
                  name="canViewScoreReports"
                  label={t("screens.users.canViewScoreReports")}
                  description={t("screens.users.scoreReportsDescription")}
                />
              </>
            ) : null}
            {isSystemAdmin ? (
            <Checkbox
              name="writesActivities"
              defaultChecked
              label={t("screens.users.writesActivities")}
              description={t("screens.users.activityWriterDescription")}
            />
            ) : null}
          </fieldset>


          <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
            <legend className="text-sm font-medium text-ink">{t("screens.users.notificationsSection")}</legend>

            {isSystemAdmin ? (
              <Checkbox
                name="sendWelcome"
                label={t("screens.users.welcomeEmail")}
                description={t("screens.users.welcomeEmailDescription")}
              />
            ) : (
              <p className="text-[length:var(--text-sm)] text-muted">
                {t("screens.users.passwordSetupDescription")}
              </p>
            )}
          </fieldset>

          <FormActions
            message={
              <>
                {state.error ? (
                    <div id="user-error">
                    <Alert tone="danger">{state.error}</Alert>
                  </div>
                ) : null}
                {state.success ? (
                    <div id="user-success">
                    <Alert tone="success">{state.success}</Alert>
                  </div>
                ) : null}
              </>
            }
          >
            <Button type="submit" variant="primary" disabled={pending}>
              {t("screens.users.add")}
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
