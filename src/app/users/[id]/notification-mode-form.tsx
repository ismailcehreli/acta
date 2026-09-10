"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { emptyNotificationModeState } from "./form-state";
import { saveNotificationModeAction } from "./notification-actions";

// Bildirim tercihi (Görev 10.8).
//
// Olay × kanal matrisi **bilerek yok**. Karmaşık bir tercih ekranı, kimsenin
// açmadığı bir ekrandır; üç seçenek gerçek üç ihtiyacı karşılıyor.

export type NotificationMode = "INSTANT" | "DAILY_DIGEST" | "ACTION_ONLY";

const SECENEKLER: {
  mode: NotificationMode;
  label: string;
  description: string;
}[] = [
  {
    mode: "INSTANT",
    label: "Anlık",
    description: "Olay olur olmaz e-posta gelir.",
  },
  {
    mode: "DAILY_DIGEST",
    label: "Günlük özet",
    description:
      "Gün içindekiler tek e-postada, akşam gelir. Acil olanlar (parola sıfırlama gibi) yine anında gider.",
  },
  {
    mode: "ACTION_ONLY",
    label: "Yalnız benden işlem isteyenler",
    description:
      "Size sorulan soru, onayınızı bekleyen kayıt ve düzeltme talebi gelir; \"onaylandı\", \"cevap geldi\" gibi bilgilendirmeler gelmez.",
  },
];

export function NotificationModeForm({ current }: { current: NotificationMode }) {
  const [state, formAction, pending] = useActionState(
    saveNotificationModeAction,
    emptyNotificationModeState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3" data-test="bildirim-tercihi">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Bildirim tercihi</legend>

        {SECENEKLER.map((secenek) => (
          <label
            key={secenek.mode}
            className="flex cursor-pointer items-start gap-2.5 rounded-(--radius-sm) border border-line px-3 py-2.5 hover:bg-surface-hover has-checked:border-primary-line has-checked:bg-primary-soft/40"
          >
            <input
              type="radio"
              name="mode"
              value={secenek.mode}
              defaultChecked={current === secenek.mode}
              className="mt-0.5 size-4 border-line-strong text-primary"
            />
            <span className="min-w-0">
              <span className="block text-[length:var(--text-sm)] font-medium text-ink">
                {secenek.label}
              </span>
              <span className="block text-[length:var(--text-xs)] text-muted">
                {secenek.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <FormMessage error={state.error} success={state.success} />

      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Tercihi kaydet"}
        </Button>
      </div>
    </form>
  );
}
