"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/form";
import { formatInstantShort } from "@/shared/format/date-time";
import type { FeedbackStatus } from "@prisma/client";
import type { FeedbackView } from "@/server/feedback/service";

import {
  archiveFeedbackAction,
  markFeedbackReadAction,
  updateFeedbackAction,
} from "./actions";
import { emptyFeedbackFormState } from "./form-state";

export type FeedbackClientView = Omit<
  FeedbackView,
  "readAt" | "reviewedAt" | "resolvedAt" | "createdAt" | "updatedAt"
> & {
  readAt: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TONES: Record<FeedbackStatus, BadgeTone> = {
  NEW: "neutral",
  IN_REVIEW: "waiting",
  RESOLVED: "success",
};

function feedbackCategoryLabel(category: FeedbackView["category"]): string {
  switch (category) {
    case "BUG":
      return "Hata";
    case "SUGGESTION":
      return "Öneri";
    case "CRITIQUE":
      return "Eleştiri";
    case "QUESTION":
      return "Soru";
  }
}

function feedbackStatusLabel(status: FeedbackStatus): string {
  switch (status) {
    case "NEW":
      return "Yeni";
    case "IN_REVIEW":
      return "İnceleniyor";
    case "RESOLVED":
      return "Çözüldü";
  }
}

function zaman(value: string | null): string | null {
  return value ? formatInstantShort(new Date(value)) : null;
}

function FeedbackAdminRow({ feedback }: { feedback: FeedbackClientView }) {
  const [state, formAction, pending] = useActionState(
    updateFeedbackAction,
    emptyFeedbackFormState,
  );

  return (
    <Card data-test="feedback-yonetim-kaydi">
      <CardHeader
        title={feedback.title}
        description={`${feedbackCategoryLabel(feedback.category)} · ${feedback.submittedByName} · ${feedback.submittedByUnitName}`}
        action={<Badge tone={STATUS_TONES[feedback.status]}>{feedbackStatusLabel(feedback.status)}</Badge>}
      />
      <CardBody className="flex flex-col gap-4">
        <p className="whitespace-pre-line text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-ink">
          {feedback.description}
        </p>

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-[length:var(--text-xs)] text-muted">
          <span>Gönderilme: {zaman(feedback.createdAt)}</span>
          {feedback.sourcePath ? <span>İlgili bölüm: {feedback.sourcePath}</span> : null}
          {feedback.adminsOnly ? <span>Yalnız sistem yöneticileri</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[length:var(--text-sm)]">
          {feedback.readAt ? (
            <span>
              Okundu: {feedback.readByName ?? "Yönetici"} · {zaman(feedback.readAt)}
            </span>
          ) : (
            <form action={markFeedbackReadAction}>
              <input type="hidden" name="id" value={feedback.id} />
              <Button type="submit" size="sm">
                Okundu olarak işaretle
              </Button>
            </form>
          )}
          {feedback.reviewedAt ? (
            <span>
              İnceleme başladı: {feedback.reviewedByName ?? "Yönetici"} · {zaman(feedback.reviewedAt)}
            </span>
          ) : null}
        </div>

        <form action={formAction} className="flex flex-col gap-4 border-t border-line pt-4">
          <input type="hidden" name="id" value={feedback.id} />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
            <label className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">Durum</span>
              <Select name="status" defaultValue={feedback.status}>
                <option value="NEW">Yeni</option>
                <option value="IN_REVIEW">İnceleniyor</option>
                <option value="RESOLVED">Çözüldü</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-sm)] font-medium text-ink">Yanıt</span>
              <Textarea
                name="response"
                defaultValue={feedback.response ?? ""}
                maxLength={5000}
                rows={3}
                placeholder="Kullanıcıya gösterilecek kısa yanıt"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Güncelle"}
            </Button>
            <FormMessage error={state.error} success={state.success} />
          </div>
        </form>

        {feedback.response ? (
          <p className="border-s-2 border-primary-line ps-3 text-[length:var(--text-sm)] text-muted">
            Mevcut yanıt: {feedback.response}
          </p>
        ) : null}

        {feedback.status === "RESOLVED" && feedback.resolvedAt ? (
          <p className="text-[length:var(--text-xs)] text-muted">
            Çözüldü: {feedback.resolvedByName ?? "Yönetici"} · {zaman(feedback.resolvedAt)}
          </p>
        ) : null}

        <form
          action={archiveFeedbackAction}
          onSubmit={(event) => {
            if (
              !window.confirm(
                "Bu geri bildirimi arşivlemek istediğinize emin misiniz? Listeden kaldırılacak, işlem kaydı tutulacak.",
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={feedback.id} />
          <Button type="submit" size="sm" variant="ghost">
            Arşivle
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function FeedbackAdmin({ feedback }: { feedback: FeedbackClientView[] }) {
  return (
    <div className="flex flex-col gap-4">
      {feedback.map((item) => (
        <FeedbackAdminRow key={item.id} feedback={item} />
      ))}
    </div>
  );
}
