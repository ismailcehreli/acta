"use client";

import { useActionState, useState } from "react";

import { useTranslations } from "@/components/i18n/provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { FormGrid } from "@/components/ui/page";

import { emptyActivityFormState } from "../form-state";
import {
  closeFollowUpAction,
  openFollowUpAction,
  reopenFollowUpAction,
} from "./follow-up-actions";


//




export interface OpenFollowUp {
  id: string;
  ownerName: string;
  openedByName: string;
  nextStep: string | null;
  reviewDate: string | null;
  idleBusinessDays: number;
}

export interface ClosedFollowUp {
  id: string;
  closedByName: string;
  closingNote: string;
  closedAt: string;
}

export function FollowUpPanel({
  activityId,
  item,
  closed,
  canManage,
  canOpen,
}: {
  activityId: string;
  item: OpenFollowUp | null;

  closed: ClosedFollowUp | null;

  canManage: boolean;

  canOpen: boolean;
}) {
  const t = useTranslations();
  const [openingOpen, setOpeningOpen] = useState(false);
  const [closingOpen, setClosingOpen] = useState(false);

  const [openingState, openingAction, openingPending] = useActionState(
    openFollowUpAction,
    emptyActivityFormState,
  );
  const [closingStatus, closingAction, closingPending] = useActionState(
    closeFollowUpAction,
    emptyActivityFormState,
  );
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenFollowUpAction,
    emptyActivityFormState,
  );

  const [reopenOpen, setReopenOpen] = useState(false);

  if (!item) {
    if (!canOpen && !closed) return null;

    return (
      <Card data-test="no-follow-up">
        <CardBody className="flex flex-col gap-3">
          {closed ? (
            <div
              className="rounded-(--radius-sm) border border-line bg-inset/40 px-3 py-2.5"
              data-test="closed-follow-up"
            >
              <p className="text-[length:var(--text-xs)] text-muted">
                {t("followUps.closedOnBy", {
                  date: closed.closedAt,
                  name: closed.closedByName,
                })}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-[length:var(--text-sm)] text-ink">
                {closed.closingNote}
              </p>

              {canManage ? (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setReopenOpen((previous) => !previous)}
                    aria-expanded={reopenOpen}
                  >
                    {reopenOpen
                      ? t("followUps.cancelReopen")
                      : t("followUps.reopen")}
                  </Button>
                </div>
              ) : null}

              {reopenOpen ? (
                <form
                  action={reopenAction}
                  className="mt-2 flex flex-col gap-2"
                  data-test="reopen-follow-up-form"
                >
                  <input type="hidden" name="id" value={closed.id} />
                  <Field
                    htmlFor="reopen-note"
                    label={t("followUps.reopenReasonLabel")}
                    hint={t("followUps.reopenHint")}
                    required
                  >
                    <Textarea
                      id="reopen-note"
                      name="note"
                      rows={2}
                      required
                      maxLength={1000}
                    />
                  </Field>
                  {reopenState.error ? (
                    <Alert tone="danger">{reopenState.error}</Alert>
                  ) : null}
                  <div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={reopenPending}
                    >
                      {reopenPending
                        ? t("followUps.opening")
                        : t("followUps.reopen")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {canOpen ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[length:var(--text-sm)] text-muted">
              {t("followUps.topicClosedHint")}
            </p>
            <Button
              type="button"
              onClick={() => setOpeningOpen((previous) => !previous)}
              aria-expanded={openingOpen}
            >
              {openingOpen
                ? t("followUps.cancelReopen")
                : t("followUps.openFollowUp")}
            </Button>
          </div>
          ) : null}

          {openingOpen ? (
            <form action={openingAction} className="flex flex-col gap-3" data-test="open-follow-up-form">
              <input type="hidden" name="activityId" value={activityId} />

              <FormGrid columns={2}>
                <Field
                  htmlFor="nextStep"
                  label={t("followUps.nextStep")}
                  hint={t("followUps.nextStepHint")}
                >
                  <Input id="nextStep" name="nextStep" maxLength={500} />
                </Field>

                <Field
                  htmlFor="reviewDate"
                  label={t("followUps.reviewDate")}
                  hint={t("followUps.reviewDateHint")}
                >
                  <Input id="reviewDate" name="reviewDate" type="date" />
                </Field>
              </FormGrid>

              {openingState.error ? (
                <Alert tone="danger">{openingState.error}</Alert>
              ) : null}

              <div>
                <Button type="submit" variant="primary" disabled={openingPending}>
                  {openingPending
                    ? t("followUps.opening")
                    : t("followUps.openFollowUp")}
                </Button>
              </div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-test="follow-up-card">
      <CardHeader
        title={t("followUps.inFollowUp")}
        description={`${t("followUps.assignedToMe")}: ${item.ownerName} · ${t("followUps.openedBy", { name: item.openedByName })}`}
      />
      <CardBody className="flex flex-col gap-3">
        <dl className="flex flex-col gap-1.5 text-[length:var(--text-sm)]">
          {item.nextStep ? (
            <div className="flex gap-2">
              <dt className="text-muted">{t("followUps.nextStep")}:</dt>
              <dd className="text-ink">{item.nextStep}</dd>
            </div>
          ) : null}

          {item.reviewDate ? (
            <div className="flex gap-2">
              <dt className="text-muted">{t("followUps.reviewDate")}:</dt>
              <dd className="text-ink">{item.reviewDate}</dd>
            </div>
          ) : null}

          <div className="flex gap-2">
            <dt className="text-muted">{t("followUps.lastActivity")}</dt>
            <dd
              className={
                item.idleBusinessDays >= 5 ? "text-correction" : "text-muted"
              }
            >
              {item.idleBusinessDays === 0
                ? t("followUps.today")
                : t("followUps.businessDaysAgo", {
                    count: item.idleBusinessDays,
                  })}
            </dd>
          </div>
        </dl>

        {canManage ? (
          <>
            <div>
              <Button
                type="button"
                onClick={() => setClosingOpen((previous) => !previous)}
                aria-expanded={closingOpen}
              >
                {closingOpen
                  ? t("followUps.cancelReopen")
                  : t("followUps.closeItem")}
              </Button>
            </div>

            {closingOpen ? (
              <form
                action={closingAction}
                className="flex flex-col gap-3"
                data-test="close-follow-up-form"
              >
                <input type="hidden" name="id" value={item.id} />

                <Field
                  htmlFor="note"
                  label={t("followUps.closingNote")}
                  hint={t("followUps.closingNoteHint")}
                  required
                >
                  <Textarea id="note" name="note" rows={3} required maxLength={1000} />
                </Field>

                {closingStatus.error ? (
                  <Alert tone="danger">{closingStatus.error}</Alert>
                ) : null}

                <div>
                  <Button type="submit" variant="primary" disabled={closingPending}>
                    {closingPending
                      ? t("followUps.closing")
                      : t("followUps.close")}
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}

      </CardBody>
    </Card>
  );
}
