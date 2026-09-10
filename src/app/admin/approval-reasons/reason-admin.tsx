"use client";

import { useActionState } from "react";

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

// Gerekçe kataloğu ekranı. Silme yok, pasifleştirme var (§16.6): geçmiş
// kararlar gerekçesini korur.

export interface ReasonRow {
  id: string;
  kind: "CHANGES_REQUESTED" | "REJECTED";
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const KIND_LABEL: Record<ReasonRow["kind"], string> = {
  CHANGES_REQUESTED: "Düzeltme iste",
  REJECTED: "Reddet",
};

function ReasonRowForm({ reason }: { reason: ReasonRow }) {
  const [state, formAction, pending] = useActionState(
    updateReasonAction,
    emptyReasonFormState,
  );
  const [aktiflikDurumu, aktiflikAction, aktiflikPending] = useActionState(
    setReasonActiveAction,
    emptyReasonFormState,
  );

  return (
    <TR data-gerekce={reason.label}>
      <TD>
        <form
          action={formAction}
          className="flex flex-wrap items-center gap-2"
          data-test="gerekce-duzenle"
        >
          <input type="hidden" name="id" value={reason.id} />
          <Input
            name="label"
            defaultValue={reason.label}
            maxLength={120}
            aria-label="Gerekçe adı"
            className="w-64"
          />
          <Input
            type="number"
            name="sortOrder"
            defaultValue={reason.sortOrder}
            min={0}
            max={999}
            aria-label="Sıra"
            className="w-20 text-right tabular"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </form>
        {state.error ? (
          <span className="mt-1 block text-xs text-danger">{state.error}</span>
        ) : null}
        {aktiflikDurumu.error ? (
          <span className="mt-1 block text-xs text-danger">{aktiflikDurumu.error}</span>
        ) : null}
      </TD>

      <TD>
        {reason.isActive ? (
          <Badge tone="success">kullanımda</Badge>
        ) : (
          <Badge tone="neutral">pasif</Badge>
        )}
      </TD>

      <TD align="right">
        <form action={aktiflikAction}>
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
            disabled={aktiflikPending}
          >
            {reason.isActive ? "Pasifleştir" : "Kullanıma aç"}
          </Button>
        </form>
      </TD>
    </TR>
  );
}

function KindCard({ kind, reasons }: { kind: ReasonRow["kind"]; reasons: ReasonRow[] }) {
  return (
    <Card>
      <CardHeader
        title={KIND_LABEL[kind]}
        description={
          kind === "REJECTED"
            ? "Kayıt kapanır ve yukarı akmaz."
            : "Kayıt yazana geri döner, düzeltilip yeniden gönderilir."
        }
      />

      {reasons.length === 0 ? (
        <EmptyState
          title="Tanımlı gerekçe yok."
          description="En az bir gerekçe olmadan bu karar verilemez."
        />
      ) : (
        <Table label="Gerekçe listesi tablosu">
          <THead>
            <TR>
              <TH>Gerekçe</TH>
              <TH>Durum</TH>
              <TH align="right">İşlem</TH>
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
  const [state, formAction, pending] = useActionState(
    createReasonAction,
    emptyReasonFormState,
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Yeni gerekçe"
          description="Sıra numarası küçük olan listede üstte çıkar."
        />
        <CardBody>
          <form
            action={formAction}
            className="flex flex-col gap-4"
            data-test="gerekce-ekle"
          >
            <FormGrid columns={3}>
              <Field htmlFor="kind" label="Karar" required>
                <Select id="kind" name="kind" defaultValue="CHANGES_REQUESTED">
                  <option value="CHANGES_REQUESTED">Düzeltme iste</option>
                  <option value="REJECTED">Reddet</option>
                </Select>
              </Field>

              <Field htmlFor="label" label="Gerekçe adı" required>
                <Input id="label" name="label" maxLength={120} required />
              </Field>

              <Field htmlFor="sortOrder" label="Sıra">
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
                {pending ? "Ekleniyor…" : "Gerekçe ekle"}
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
