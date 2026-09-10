"use client";

import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";

import { emptyActivityFormState } from "../form-state";
import {
  approveActivityAction,
  rejectActivityAction,
  requestChangesAction,
} from "./approval-actions";

// Onay paneli (§5.4). Yalnız **aktif onaylayıcıya** ve yalnız karar bekleyen
// kayıtta gösterilir; yetkinin kendisi sunucuda ayrıca doğrulanır.
//
// Üç karar üç ayrı formdur: tek forma üç düğme koyup hangisine basıldığını
// gizli alandan okumak, yanlış düğmeye basmayı sessiz bir hataya çevirirdi.
//
// Gerekçe **kategori olarak** seçilir; serbest açıklama isteğe bağlıdır.
// Herkesin kendi cümlesini yazdığı bir yığın raporlanamaz (ürün sahibi
// kararı, 19.08.2026).

export interface ReasonOption {
  id: string;
  label: string;
}

/** Kategori + isteğe bağlı açıklama; iki kararda da aynı düzen. */
function DecisionForm({
  activityId,
  adi,
  reasons,
  action,
  pending,
  gerekceEtiketi,
  ipucu,
  dugme,
  bekleyen,
}: {
  activityId: string;
  adi: string;
  reasons: ReasonOption[];
  action: (formData: FormData) => void;
  pending: boolean;
  gerekceEtiketi: string;
  ipucu: string;
  dugme: string;
  bekleyen: string;
}) {
  const secimId = `${adi}-gerekce-${activityId}`;
  const notId = `${adi}-aciklama-${activityId}`;

  if (reasons.length === 0) {
    return (
      <Alert tone="correction">
        Bu karar için tanımlı gerekçe yok. Sistem yöneticisi
        &nbsp;<span className="font-medium">Yönetim → Onay gerekçeleri</span>
        &nbsp;ekranından tanımlamalı.
      </Alert>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" data-test={`${adi}-formu`}>
      <input type="hidden" name="id" value={activityId} />

      <Field htmlFor={secimId} label={gerekceEtiketi} hint={ipucu} required>
        <Select id={secimId} name="reasonId" required defaultValue="">
          <option value="" disabled>
            Seçiniz…
          </option>
          {reasons.map((reason) => (
            <option key={reason.id} value={reason.id}>
              {reason.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        htmlFor={notId}
        label="Açıklama (isteğe bağlı)"
        hint="Yazan kişi bunu ekranında görür."
      >
        <Textarea id={notId} name="note" rows={3} maxLength={1000} />
      </Field>

      <div>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? bekleyen : dugme}
        </Button>
      </div>
    </form>
  );
}

export function ApprovalPanel({
  activityId,
  canApprove,
  changesReasons,
  rejectReasons,
}: {
  activityId: string;
  /** Düzeltme istenmiş kayıtta onaylanacak bir şey yoktur; yalnız ret kalır. */
  canApprove: boolean;
  changesReasons: ReasonOption[];
  rejectReasons: ReasonOption[];
}) {
  const [acik, setAcik] = useState<"yok" | "duzeltme" | "ret">("yok");

  const [onayDurumu, onayAction, onayPending] = useActionState(
    approveActivityAction,
    emptyActivityFormState,
  );
  const [duzeltmeDurumu, duzeltmeAction, duzeltmePending] = useActionState(
    requestChangesAction,
    emptyActivityFormState,
  );
  const [retDurumu, retAction, retPending] = useActionState(
    rejectActivityAction,
    emptyActivityFormState,
  );

  return (
    <div className="flex flex-col gap-3" data-test="onay-paneli">
      <div className="flex flex-wrap items-center gap-2">
        {canApprove ? (
          <form action={onayAction}>
            <input type="hidden" name="id" value={activityId} />
            <Button type="submit" variant="primary" disabled={onayPending}>
              {onayPending ? "Onaylanıyor…" : "Onayla"}
            </Button>
          </form>
        ) : null}

        {canApprove ? (
          <Button
            type="button"
            onClick={() => setAcik((o) => (o === "duzeltme" ? "yok" : "duzeltme"))}
            aria-expanded={acik === "duzeltme"}
          >
            {acik === "duzeltme" ? "Vazgeç" : "Düzeltme iste"}
          </Button>
        ) : null}

        <Button
          type="button"
          onClick={() => setAcik((o) => (o === "ret" ? "yok" : "ret"))}
          aria-expanded={acik === "ret"}
        >
          {acik === "ret" ? "Vazgeç" : "Reddet"}
        </Button>
      </div>

      {acik === "duzeltme" ? (
        <DecisionForm
          activityId={activityId}
          adi="duzeltme"
          reasons={changesReasons}
          action={duzeltmeAction}
          pending={duzeltmePending}
          gerekceEtiketi="Düzeltme gerekçesi"
          ipucu="Yazan kişi bunu görür ve kaydı düzeltip yeniden gönderir."
          dugme="Düzeltme iste"
          bekleyen="Gönderiliyor…"
        />
      ) : null}

      {acik === "ret" ? (
        <DecisionForm
          activityId={activityId}
          adi="ret"
          reasons={rejectReasons}
          action={retAction}
          pending={retPending}
          gerekceEtiketi="Ret gerekçesi"
          ipucu="Kayıt kapanır ve yukarı akmaz. Silinmez; yazan ve siz görmeye devam edersiniz."
          dugme="Reddet"
          bekleyen="Reddediliyor…"
        />
      ) : null}

      {onayDurumu.error ? <Alert tone="danger">{onayDurumu.error}</Alert> : null}
      {duzeltmeDurumu.error ? (
        <Alert tone="danger">{duzeltmeDurumu.error}</Alert>
      ) : null}
      {retDurumu.error ? <Alert tone="danger">{retDurumu.error}</Alert> : null}
    </div>
  );
}
