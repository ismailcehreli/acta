"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "@/components/i18n";

import { FormMessage } from "@/components/ui/alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";
import type { LegacyDemoOriginCandidate } from "@/server/demo/origin";

import {
  classifyLegacyDemoOriginsAction,
  installDemoAction,
  purgeDemoAction,
} from "./actions";
import { emptySettingsFormState } from "./form-state";


//




// public holidays.

export function DemoForm({
  installed,
  legacyOriginCandidates,
}: {
  installed: boolean;
  legacyOriginCandidates: LegacyDemoOriginCandidate[];
}) {
  const t = useTranslations();
  const [installState, installAction, installPending] = useActionState(
    async () => installDemoAction(),
    emptySettingsFormState,
  );
  const [deletionState, deleteAction, deletePending] = useActionState(
    purgeDemoAction,
    emptySettingsFormState,
  );
  const [originState, originAction, originPending] = useActionState(
    classifyLegacyDemoOriginsAction,
    emptySettingsFormState,
  );
  const [deletionOpen, setDeletionOpen] = useState(false);

  return (
    <Card>
      <CardHeader
        title={t("screens.settingsForms.demo.title")}
        description={t("screens.settingsForms.demo.description")}
      />
      <CardBody>
        <div className="flex flex-col gap-5">
          <div>
            <p className="prose-measure text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
              {t("screens.settingsForms.demo.installationNote", { domain: "@example.test" })}
            </p>

            <form action={installAction} className="mt-4">
              <FormActions
                message={<FormMessage error={installState.error} success={installState.success} />}
              >
                <Button type="submit" variant="primary" disabled={installPending}>
                  {installed ? t("screens.settingsForms.demo.completeMissing") : t("screens.settingsForms.demo.install")}
                </Button>
              </FormActions>
            </form>
          </div>

          {installed ? (
            <div className="border-t border-line pt-5">
              <p className="section-label mb-2">{t("screens.settingsForms.demo.cleanup")}</p>
              <p className="prose-measure text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
                {t("screens.settingsForms.demo.cleanupDescription", { domain: "@example.test" })}
              </p>
              <p className="prose-measure mt-2 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
                {t("screens.settingsForms.demo.sharedSettingsDescription")}
              </p>

              {legacyOriginCandidates.length > 0 ? (
                <form action={originAction} className="mt-4 flex flex-col gap-4">
                  <Alert tone="correction" title={t("screens.settingsForms.demo.legacyTitle")}>
                    {t("screens.settingsForms.demo.legacyDescription")}
                  </Alert>

                  <div className="flex flex-col gap-3">
                    {legacyOriginCandidates.map((unit) => (
                      <fieldset
                        key={unit.id}
                        className="rounded-(--radius-sm) border border-line bg-inset/40 p-3.5"
                      >
                        <legend className="px-1 text-[length:var(--text-sm)] font-semibold text-ink">
                          {unit.name}
                        </legend>
                        <input type="hidden" name="orgUnitId" value={unit.id} />
                        <p className="mb-2 text-[length:var(--text-xs)] text-muted">
                          {t("screens.settingsForms.demo.parentUnit")}: {unit.parentName ?? t("common.none")} · ID:{" "}
                          <span className="mono break-all">{unit.id}</span>
                        </p>
                        <label className="flex min-h-(--spacing-touch) items-start gap-2.5 py-1 text-[length:var(--text-sm)]">
                          <input
                            type="radio"
                            name={`origin:${unit.id}`}
                            value="CREATED_BY_INSTALLER"
                            required
                            className="mt-1 size-4"
                          />
                          <span>
                            <span className="font-medium text-ink">
                              {t("screens.settingsForms.demo.createdByInstaller")}
                            </span>
                            <span className="block text-[length:var(--text-xs)] text-muted">
                              {t("screens.settingsForms.demo.createdByInstallerDescription")}
                            </span>
                          </span>
                        </label>
                        <label className="flex min-h-(--spacing-touch) items-start gap-2.5 py-1 text-[length:var(--text-sm)]">
                          <input
                            type="radio"
                            name={`origin:${unit.id}`}
                            value="REUSED_EXISTING"
                            required
                            className="mt-1 size-4"
                          />
                          <span>
                            <span className="font-medium text-ink">
                              {t("screens.settingsForms.demo.reusedExisting")}
                            </span>
                            <span className="block text-[length:var(--text-xs)] text-muted">
                              {t("screens.settingsForms.demo.reusedExistingDescription")}
                            </span>
                          </span>
                        </label>
                      </fieldset>
                    ))}
                  </div>

                  <FormActions
                    message={
                      <FormMessage
                        error={originState.error}
                        success={originState.success}
                      />
                    }
                  >
                    <Button type="submit" variant="primary" disabled={originPending}>
                    {t("screens.settingsForms.demo.saveOriginDecisions")}
                    </Button>
                  </FormActions>
                </form>
              ) : deletionOpen ? (
                <form action={deleteAction} className="mt-4 flex flex-col gap-4">
                  <Alert tone="danger">
                    {t("screens.settingsForms.demo.irreversible")}
                  </Alert>

                  <Field
                    htmlFor="confirmation"
                    label={t("screens.settingsForms.demo.confirmation")}
                    hint={t("screens.settingsForms.demo.confirmationHint")}
                    required
                  >
                    <Input
                      id="confirmation"
                      name="confirmation"
                      autoComplete="off"
                      placeholder="DELETE"
                      className="max-w-40"
                    />
                  </Field>

                  <FormActions
                    message={<FormMessage error={deletionState.error} success={deletionState.success} />}
                  >
                    <Button type="submit" variant="danger" disabled={deletePending}>
                      {t("screens.settingsForms.demo.delete")}
                    </Button>
                    <Button type="button" onClick={() => setDeletionOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                  </FormActions>
                </form>
              ) : (
                <div className="mt-4">
                  <Button type="button" onClick={() => setDeletionOpen(true)}>
                    {t("screens.settingsForms.demo.deleting")}
                  </Button>
                  <div className="mt-2">
                    <FormMessage error={deletionState.error} success={deletionState.success} />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
