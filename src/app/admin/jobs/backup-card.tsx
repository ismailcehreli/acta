"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "@/components/i18n";
import { LOCALE_LANGUAGE_TAGS, type Locale } from "@/shared/i18n";

import { Alert, FormMessage } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { BackupRequestView } from "@/server/backup/requests";

import { requestBackupAction } from "./actions";
import { emptyBackupFormState } from "./form-state";

const STATUS_TONES: Record<BackupRequestView["status"], BadgeTone> = {
  PENDING: "waiting",
  RUNNING: "info",
  DONE: "success",
  FAILED: "danger",
};

function sourceLabel(source: BackupRequestView["source"], t: ReturnType<typeof useTranslations>): string {
  return source === "MANUAL"
    ? t("screens.jobs.backupManual")
    : t("screens.jobs.backupAutomatic");
}

function dateText(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_LANGUAGE_TAGS[locale], {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSize(value: string | null): string {
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
  const t = useTranslations();
  const locale = useLocale();
  const statusLabels: Record<BackupRequestView["status"], string> = {
    PENDING: t("screens.jobs.backupPending"),
    RUNNING: t("screens.jobs.backupRunning"),
    DONE: t("screens.jobs.backupDone"),
    FAILED: t("screens.jobs.backupFailed"),
  };
  const [state, formAction, pending] = useActionState(
    requestBackupAction,
    emptyBackupFormState,
  );

  return (
    <Card id="backups" data-test="backup-card">
      <CardHeader
        title={t("screens.jobs.backupTitle")}
        description={t("screens.jobs.backupDescription")}
        action={
          <form action={formAction}>
            <Button type="submit" variant="primary" disabled={pending || active !== null}>
              {pending ? t("screens.jobs.requestingBackup") : t("screens.jobs.requestBackup")}
            </Button>
          </form>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <FormMessage error={state.error} success={state.success} />

        {active ? (
          <Alert tone="waiting" title={t("screens.jobs.backupInProgress")}>
            {active.status === "RUNNING"
              ? t("screens.jobs.backupInProgressDescription")
              : t("screens.jobs.backupWaitingDescription")}
          </Alert>
        ) : null}

        <p className="text-[length:var(--text-xs)] text-muted">
          {t("screens.jobs.backupPanelNote")}
        </p>

        {history.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-muted">{t("screens.jobs.noBackups")}</p>
        ) : (
          <Table label={t("screens.jobs.backupHistory")}>
            <THead>
              <TR>
                <TH>{t("screens.jobs.date")}</TH>
                <TH>{t("screens.jobs.source")}</TH>
                <TH>{t("screens.jobs.status")}</TH>
                <TH align="right">{t("screens.jobs.size")}</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((request) => (
                <TR key={request.id} data-test="backup-record">
                  <TD className="text-muted">{dateText(request.requestedAt, locale)}</TD>
                  <TD>{sourceLabel(request.source, t)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONES[request.status]}>
                      {statusLabels[request.status]}
                    </Badge>
                    {request.message ? (
                      <p className="mt-1 text-[length:var(--text-xs)] text-danger">
                        {t("screens.jobs.backupFailureDetails", { message: request.message })}
                      </p>
                    ) : null}
                    {request.fileName ? (
                      <p className="mt-1 text-[length:var(--text-xs)] text-muted">
                        {request.fileName}
                      </p>
                    ) : null}
                  </TD>
                  <TD align="right" className="tabular">
                    {formatSize(request.sizeBytes)}
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
