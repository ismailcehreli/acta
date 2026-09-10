"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

import { deleteDraftAction } from "./actions";
import { emptyDraftState } from "./form-state";

// Taslak silme.
//
// **İki adımlı**, çünkü geri alınamaz: taslak silinince metin gider. Tek
// tıkla silen bir düğme, yanlış satıra basan kullanıcının yazdığını yok
// ederdi.
//
// Tarayıcı `confirm()` kutusu kullanılmıyor: sayfayı bloke ediyor, biçimi
// sisteme ait değil ve mobilde kaba duruyor. Yerine düğme kendi yerinde
// "Sil / Vazgeç" ikilisine dönüşüyor.

export function DeleteDraftButton({ id, title }: { id: string; title: string }) {
  const [state, formAction, pending] = useActionState(
    deleteDraftAction,
    emptyDraftState,
  );
  const [onayBekliyor, setOnayBekliyor] = useState(false);

  if (!onayBekliyor) {
    return (
      <>
        <Button
          type="button"
          size="sm"
          onClick={() => setOnayBekliyor(true)}
          aria-label={`${title} taslağını sil`}
        >
          Sil
        </Button>
        {state.error ? (
          <span className="text-[length:var(--text-xs)] text-danger">
            {state.error}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-[length:var(--text-xs)] text-muted">Silinsin mi?</span>
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? "Siliniyor…" : "Sil"}
      </Button>
      <Button type="button" size="sm" onClick={() => setOnayBekliyor(false)}>
        Vazgeç
      </Button>
    </form>
  );
}
