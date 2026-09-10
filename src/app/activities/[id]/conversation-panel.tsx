"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import type { ConversationView } from "@/server/conversations/read";

import {
  askQuestionAction,
  closeConversationAction,
  replyAction,
} from "./conversation-actions";
import { emptyConversationFormState } from "./conversation-state";
import { formatInstant } from "@/shared/format/date-time";

// Soru–cevap arayüzü (§9). Soru cevaplanana kadar hem soranın hem sorumlunun
// listesinde durur; burada da kimin sırası olduğu açıkça yazılır.

export function AskQuestionForm({ activityId }: { activityId: string }) {
  const [state, formAction, pending] = useActionState(
    askQuestionAction,
    emptyConversationFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="activityId" value={activityId} />

      <Field htmlFor="yeni-soru" label="Soru sor" required>
        <Textarea id="yeni-soru" name="text" rows={3} required />
      </Field>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Gönderiliyor…" : "Soruyu gönder"}
        </Button>
      </div>
    </form>
  );
}

function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState(
    replyAction,
    emptyConversationFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor={`cevap-${conversationId}`} className="sr-only">
        Cevap
      </label>
      <Textarea
        id={`cevap-${conversationId}`}
        name="text"
        rows={2}
        required
        placeholder="Cevabınızı yazın"
      />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Gönder
        </Button>
      </div>
    </form>
  );
}

function CloseForm({
  conversationId,
  requiresReason,
}: {
  conversationId: string;
  /** Zorunlu kapatma gerekçesiz yapılamaz (§9.3). */
  requiresReason: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    closeConversationAction,
    emptyConversationFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      {requiresReason ? (
        <Field
          htmlFor={`kapatma-gerekce-${conversationId}`}
          label="Zorunlu kapatma nedeni"
          required
        >
          <Textarea
            id={`kapatma-gerekce-${conversationId}`}
            name="reason"
            required
            maxLength={500}
            rows={2}
          />
        </Field>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          Konuşmayı kapat
        </Button>
      </div>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
    </form>
  );
}

/** Kapanış türünün Türkçe eki; normal kapanışta ek yoktur. */
function kapanisEtiketi(closeType: string | null): string {
  if (closeType === "ADMINISTRATIVE") return " (yetkili tarafından kapatıldı)";
  if (closeType === "CANCELLED_ACTIVITY") return " (faaliyet iptal edildi)";
  return "";
}

export function ConversationList({
  conversations,
  viewerId,
  viewerIsSystemAdmin,
}: {
  conversations: ConversationView[];
  viewerId: string;
  /** İşlevsel yönetici; kapatması idari sayılır ve gerekçe ister (§9.3). */
  viewerIsSystemAdmin: boolean;
}) {
  if (conversations.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-muted">
        Bu faaliyet üzerinde henüz soru yok.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {conversations.map((conversation) => {
        const isParty =
          conversation.askerId === viewerId ||
          conversation.messages.some((m) => m.authorId === viewerId) ||
          conversation.responsibleId === viewerId;

        return (
          <li
            key={conversation.id}
            data-durum={conversation.status === "OPEN" ? "acik" : "kapali"}
            className="rounded-(--radius-sm) border border-line bg-inset/40 p-3.5"
          >
            <div className="flex flex-wrap items-baseline gap-2 text-[length:var(--text-sm)]">
              <span className="font-medium text-ink">
                {conversation.askerName} sordu
              </span>
              <span className="text-[length:var(--text-xs)] text-muted tabular">
                {formatInstant(conversation.openedAt)}
              </span>
              {conversation.status === "OPEN" ? (
                <Badge tone="waiting">sıra: {conversation.responsibleName}</Badge>
              ) : (
                <Badge>kapalı{kapanisEtiketi(conversation.closeType)}</Badge>
              )}
            </div>

            {/* Mesajlar sola dayalı bir zaman çizgisi olarak durur: kim, ne
                zaman, ne yazdı — üçü de aynı hizada okunur. */}
            <ul className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-3">
              {conversation.messages.map((message) => (
                <li key={message.id} className="text-[length:var(--text-sm)]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-ink">
                      {message.authorName}
                    </span>
                    <span className="text-[length:var(--text-xs)] text-muted tabular">
                      {formatInstant(message.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-line text-muted">
                    {message.text}
                  </p>
                </li>
              ))}
            </ul>

            {conversation.status === "OPEN" ? (
              <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                {isParty ? <ReplyForm conversationId={conversation.id} /> : null}
                <CloseForm
                  conversationId={conversation.id}
                  // Ekranın tahmini yalnız alanı göstermek içindir; kararı sunucu
                  // verir ve gerekçesiz zorunlu kapatmayı reddeder. Sistem
                  // yöneticisi aynı zamanda soranın üstüyse kapatma normal sayılır
                  // ve yazdığı gerekçe kaydedilmez — zorunlu işlem yapılmamıştır.
                  requiresReason={
                    viewerIsSystemAdmin && conversation.askerId !== viewerId
                  }
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
