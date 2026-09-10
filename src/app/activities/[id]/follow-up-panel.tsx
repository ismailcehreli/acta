"use client";

import { useActionState, useState } from "react";

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

// Takip maddesi kartı (§11).
//
// Kart yalnız kaydı **tam görebilen** kişiye çizilir; yetkinin kendisi sunucuda
// ayrıca doğrulanır. Kapanış notu zorunlu — notsuz kapatma, Excel'deki ölü
// Açık/Kapalı sütununun aynısı olurdu.

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
  /** En son kapanmış madde; varsa notu gösterilir ve yeniden açılabilir. */
  closed: ClosedFollowUp | null;
  /** Kapatma/yeniden açma yetkisi: sahibi, açan ya da üstü. */
  canManage: boolean;
  /** Kayıt açık bir duruma sahip mi (iptal/ret değil). */
  canOpen: boolean;
}) {
  const [acmaAcik, setAcmaAcik] = useState(false);
  const [kapatmaAcik, setKapatmaAcik] = useState(false);

  const [acmaDurumu, acmaAction, acmaPending] = useActionState(
    openFollowUpAction,
    emptyActivityFormState,
  );
  const [kapatmaDurumu, kapatmaAction, kapatmaPending] = useActionState(
    closeFollowUpAction,
    emptyActivityFormState,
  );
  const [acmaTekrarDurumu, acmaTekrarAction, acmaTekrarPending] = useActionState(
    reopenFollowUpAction,
    emptyActivityFormState,
  );

  const [yenidenAcik, setYenidenAcik] = useState(false);

  if (!item) {
    if (!canOpen && !closed) return null;

    return (
      <Card data-test="takip-yok">
        <CardBody className="flex flex-col gap-3">
          {closed ? (
            <div
              className="rounded-(--radius-sm) border border-line bg-inset/40 px-3 py-2.5"
              data-test="takip-kapali"
            >
              <p className="text-[length:var(--text-xs)] text-muted">
                Takip {closed.closedAt} tarihinde {closed.closedByName} tarafından
                kapatıldı.
              </p>
              <p className="mt-0.5 whitespace-pre-line text-[length:var(--text-sm)] text-ink">
                {closed.closingNote}
              </p>

              {canManage ? (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setYenidenAcik((onceki) => !onceki)}
                    aria-expanded={yenidenAcik}
                  >
                    {yenidenAcik ? "Vazgeç" : "Yeniden aç"}
                  </Button>
                </div>
              ) : null}

              {yenidenAcik ? (
                <form
                  action={acmaTekrarAction}
                  className="mt-2 flex flex-col gap-2"
                  data-test="takip-yeniden-ac-formu"
                >
                  <input type="hidden" name="id" value={closed.id} />
                  <Field
                    htmlFor="reopen-note"
                    label="Yeniden açma gerekçesi"
                    hint="Konu neden yeniden açılıyor?"
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
                  {acmaTekrarDurumu.error ? (
                    <Alert tone="danger">{acmaTekrarDurumu.error}</Alert>
                  ) : null}
                  <div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={acmaTekrarPending}
                    >
                      {acmaTekrarPending ? "Açılıyor…" : "Yeniden aç"}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {canOpen ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[length:var(--text-sm)] text-muted">
              Bu konu kapandı mı? Açık kalması gerekiyorsa takip maddesi açın.
            </p>
            <Button
              type="button"
              onClick={() => setAcmaAcik((onceki) => !onceki)}
              aria-expanded={acmaAcik}
            >
              {acmaAcik ? "Vazgeç" : "Takip aç"}
            </Button>
          </div>
          ) : null}

          {acmaAcik ? (
            <form action={acmaAction} className="flex flex-col gap-3" data-test="takip-ac-formu">
              <input type="hidden" name="activityId" value={activityId} />

              <FormGrid columns={2}>
                <Field
                  htmlFor="nextStep"
                  label="Sonraki adım (isteğe bağlı)"
                  hint="Ne bekleniyor? Örn. parça gelince haber ver."
                >
                  <Input id="nextStep" name="nextStep" maxLength={500} />
                </Field>

                <Field
                  htmlFor="reviewDate"
                  label="Gözden geçirme günü (isteğe bağlı)"
                  hint="O gün geldiğinde listede işaretlenir."
                >
                  <Input id="reviewDate" name="reviewDate" type="date" />
                </Field>
              </FormGrid>

              {acmaDurumu.error ? (
                <Alert tone="danger">{acmaDurumu.error}</Alert>
              ) : null}

              <div>
                <Button type="submit" variant="primary" disabled={acmaPending}>
                  {acmaPending ? "Açılıyor…" : "Takibi aç"}
                </Button>
              </div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card data-test="takip-karti">
      <CardHeader
        title="Takipte"
        description={`Sorumlu: ${item.ownerName} · ${item.openedByName} açtı`}
      />
      <CardBody className="flex flex-col gap-3">
        <dl className="flex flex-col gap-1.5 text-[length:var(--text-sm)]">
          {item.nextStep ? (
            <div className="flex gap-2">
              <dt className="text-muted">Sonraki adım:</dt>
              <dd className="text-ink">{item.nextStep}</dd>
            </div>
          ) : null}

          {item.reviewDate ? (
            <div className="flex gap-2">
              <dt className="text-muted">Gözden geçirme:</dt>
              <dd className="text-ink">{item.reviewDate}</dd>
            </div>
          ) : null}

          <div className="flex gap-2">
            <dt className="text-muted">Son hareket:</dt>
            <dd
              className={
                item.idleBusinessDays >= 5 ? "text-correction" : "text-muted"
              }
            >
              {item.idleBusinessDays === 0
                ? "bugün"
                : `${item.idleBusinessDays} iş günü önce`}
            </dd>
          </div>
        </dl>

        {canManage ? (
          <>
            <div>
              <Button
                type="button"
                onClick={() => setKapatmaAcik((onceki) => !onceki)}
                aria-expanded={kapatmaAcik}
              >
                {kapatmaAcik ? "Vazgeç" : "Takibi kapat"}
              </Button>
            </div>

            {kapatmaAcik ? (
              <form
                action={kapatmaAction}
                className="flex flex-col gap-3"
                data-test="takip-kapat-formu"
              >
                <input type="hidden" name="id" value={item.id} />

                <Field
                  htmlFor="note"
                  label="Kapanış notu"
                  hint="Ne oldu, konu nasıl kapandı? Bu not kayıtta kalır."
                  required
                >
                  <Textarea id="note" name="note" rows={3} required maxLength={1000} />
                </Field>

                {kapatmaDurumu.error ? (
                  <Alert tone="danger">{kapatmaDurumu.error}</Alert>
                ) : null}

                <div>
                  <Button type="submit" variant="primary" disabled={kapatmaPending}>
                    {kapatmaPending ? "Kapatılıyor…" : "Kapat"}
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
