"use client";

import { useActionState } from "react";

import { Alert, FormMessage } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { BackupRequestView } from "@/server/backup/requests";

import { requestBackupAction } from "./actions";
import { emptyBackupFormState } from "./form-state";

const STATUS_LABELS: Record<BackupRequestView["status"], string> = {
  PENDING: "Bekliyor",
  RUNNING: "Alınıyor",
  DONE: "Tamamlandı",
  FAILED: "Başarısız",
};

const STATUS_TONES: Record<BackupRequestView["status"], BadgeTone> = {
  PENDING: "waiting",
  RUNNING: "info",
  DONE: "success",
  FAILED: "danger",
};

function kaynakMetni(source: BackupRequestView["source"]): string {
  return source === "MANUAL" ? "Elle" : "Otomatik";
}

function tarihMetni(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function boyutMetni(value: string | null): string {
  if (value === null) return "—";
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function BackupCard({
  active,
  history,
}: {
  active: BackupRequestView | null;
  history: BackupRequestView[];
}) {
  const [state, formAction, pending] = useActionState(
    requestBackupAction,
    emptyBackupFormState,
  );

  return (
    <Card id="yedekleme" data-test="yedekleme-karti">
      <CardHeader
        title="Yedekleme"
        description="Yedek isteği bırakın; sunucudaki koşucu isteği alıp yedeği alır. Uygulama bu işlem sırasında kısa süreliğine durabilir."
        action={
          <form action={formAction}>
            <Button type="submit" variant="primary" disabled={pending || active !== null}>
              {pending ? "İsteniyor…" : "Şimdi yedek al"}
            </Button>
          </form>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <FormMessage error={state.error} success={state.success} />

        {active ? (
          <Alert tone="waiting" title="Bir yedek işlemi sürüyor">
            {active.status === "RUNNING"
              ? "Yedek alınıyor. Bu sayfayı yenileyerek durumu kontrol edebilirsiniz."
              : "İstek bekliyor. Koşucu çalıştığında yedek alınacak."}
          </Alert>
        ) : null}

        <p className="text-[length:var(--text-xs)] text-muted">
          Yedek dosyası bu panelden indirilmez. Burada yalnızca işlem durumu,
          dosya adı ve boyutu gösterilir.
        </p>

        {history.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-muted">Henüz yedek alınmadı.</p>
        ) : (
          <Table label="Yedek geçmişi tablosu">
            <THead>
              <TR>
                <TH>Tarih</TH>
                <TH>Kaynak</TH>
                <TH>Durum</TH>
                <TH align="right">Boyut</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((request) => (
                <TR key={request.id} data-test="yedek-kaydi">
                  <TD className="text-muted">{tarihMetni(request.requestedAt)}</TD>
                  <TD>{kaynakMetni(request.source)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONES[request.status]}>
                      {STATUS_LABELS[request.status]}
                    </Badge>
                    {request.message ? (
                      <p className="mt-1 text-[length:var(--text-xs)] text-danger">
                        {request.message}
                      </p>
                    ) : null}
                    {request.fileName ? (
                      <p className="mt-1 text-[length:var(--text-xs)] text-muted">
                        {request.fileName}
                      </p>
                    ) : null}
                  </TD>
                  <TD align="right" className="tabular">
                    {boyutMetni(request.sizeBytes)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
