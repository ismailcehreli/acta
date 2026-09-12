"use client";

import { useActionState } from "react";

import { useTranslations } from "@/components/i18n";
import { FormMessage } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { FormGrid } from "@/components/ui/page";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

import {
  createReasonAction,
  setReasonActiveAction,
  updateReasonAction,
} from "./actions";
import { emptyReasonFormState } from "./form-state";




export interface ReasonRow {
  id: string;
  kind: "CHANGES_REQUESTED" | "REJECTED";
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const KIND_LABEL_KEYS: Record<ReasonRow["kind"], string> = {
  CHANGES_REQUESTED: "screens.approvalReasons.requestChanges",
  REJECTED: "screens.approvalReasons.reject",
};

function ReasonRowForm({ reason }: { reason: ReasonRow }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    updateReasonAction,
    emptyReasonFormState,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    setReasonActiveAction,
    emptyReasonFormState,
  );

  return (
    <TR data-reason={reason.label}>
      <TD>
        <form
          action={formAction}
          className="flex flex-wrap items-center gap-2"
          data-test="reason-edit"
        >
          <input type="hidden" name="id" value={reason.id} />
          <Input
            name="label"
            defaultValue={reason.label}
            maxLength={120}
            aria-label={t("screens.approvalReasons.reasonName")}
            className="w-64"
          />
          <Input
            type="number"
            name="sortOrder"
            defaultValue={reason.sortOrder}
            min={0}
            max={999}
            aria-label={t("screens.approvalReasons.order")}
            className="w-20 text-right tabular"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending
              ? t("screens.approvalReasons.saving")
              : t("screens.approvalReasons.save")}
          </Button>
        </form>
        {state.error ? (
          <span className="mt-1 block text-xs text-danger">{state.error}</span>
        ) : null}
        {statusState.error ? (
          <span className="mt-1 block text-xs text-danger">{statusState.error}</span>
        ) : null}
      </TD>

      <TD>
        {reason.isActive ? (
          <Badge tone="success">{t("screens.approvalReasons.active")}</Badge>
        ) : (
          <Badge tone="neutral">{t("screens.approvalReasons.inactive")}</Badge>
        )}
      </TD>

      <TD align="right">
        <form action={statusAction}>
          <input type="hidden" name="id" value={reason.id} />
          <input
            type="hidden"
            name="isActive"
            value={reason.isActive ? "false" : "true"}
          />
          <Button
            type="submit"
            size="sm"
            variant={reason.isActive ? "danger" : "primary"}
            disabled={statusPending}
          >
            {reason.isActive
              ? t("screens.approvalReasons.deactivate")
              : t("screens.approvalReasons.activate")}
          </Button>
        </form>
      </TD>
    </TR>
  );
}

function KindCard({ kind, reasons }: { kind: ReasonRow["kind"]; reasons: ReasonRow[] }) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader
        title={t(KIND_LABEL_KEYS[kind])}
        description={
          kind === "REJECTED"
            ? t("screens.approvalReasons.rejectDescription")
            : t("screens.approvalReasons.requestChangesDescription")
        }
      />

      {reasons.length === 0 ? (
        <EmptyState
          title={t("screens.approvalReasons.noReason")}
          description={t("screens.approvalReasons.noReasonDescription")}
        />
      ) : (
        <Table label={t("screens.approvalReasons.reasonTable")}>
          <THead>
            <TR>
              <TH>{t("screens.approvalReasons.reason")}</TH>
              <TH>{t("screens.approvalReasons.status")}</TH>
              <TH align="right">{t("screens.approvalReasons.operation")}</TH>
            </TR>
          </THead>
          <TBody>
            {reasons.map((reason) => (
              <ReasonRowForm key={reason.id} reason={reason} />
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

export function ReasonAdmin({ reasons }: { reasons: ReasonRow[] }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    createReasonAction,
    emptyReasonFormState,
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title={t("screens.approvalReasons.newReason")}
          description={t("screens.approvalReasons.newReasonDescription")}
        />
        <CardBody>
          <form
            action={formAction}
            className="flex flex-col gap-4"
            data-test="reason-add"
          >
            <FormGrid columns={3}>
              <Field htmlFor="kind" label={t("screens.approvalReasons.decision")} required>
                <Select id="kind" name="kind" defaultValue="CHANGES_REQUESTED">
                  <option value="CHANGES_REQUESTED">
                    {t("screens.approvalReasons.requestChanges")}
                  </option>
                  <option value="REJECTED">{t("screens.approvalReasons.reject")}</option>
                </Select>
              </Field>

              <Field htmlFor="label" label={t("screens.approvalReasons.reasonName")} required>
                <Input id="label" name="label" maxLength={120} required />
              </Field>

              <Field htmlFor="sortOrder" label={t("screens.approvalReasons.order")}>
                <Input
                  id="sortOrder"
                  type="number"
                  name="sortOrder"
                  defaultValue={0}
                  min={0}
                  max={999}
                  className="tabular"
                />
              </Field>
            </FormGrid>

            <FormMessage error={state.error} success={state.success} />

            <div>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending
                  ? t("screens.approvalReasons.adding")
                  : t("screens.approvalReasons.addReason")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <KindCard
        kind="CHANGES_REQUESTED"
        reasons={reasons.filter((r) => r.kind === "CHANGES_REQUESTED")}
      />
      <KindCard
        kind="REJECTED"
        reasons={reasons.filter((r) => r.kind === "REJECTED")}
      />
    </div>
  );
}
