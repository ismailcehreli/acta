"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import {
  AttachmentPicker,
  type AttachmentPickerItem,
} from "@/components/activities/attachment-picker";
import type { TargetOption } from "@/server/activities/target-options";
import { MAX_TARGET_DEPARTMENTS } from "@/shared/schemas/activity";

import { useActivityDraft } from "@/components/forms/use-activity-draft";
import { useServerDraft } from "@/components/forms/use-server-draft";
import { DepartmentPicker } from "./department-picker";
import { savedAtLabel } from "@/shared/drafts/activity-draft";

import { saveDraftAction } from "@/app/drafts/actions";
import { emptyDraftState } from "@/app/drafts/form-state";

import { createActivityAction, updateActivityAction } from "./actions";
import { emptyActivityFormState } from "./form-state";
import type { ActivityTextLimits } from "@/shared/schemas/activity";

// Giriş hızlı olmalı (§18.6: 30 saniye ölçütü). Bu yüzden alan sayısı tasarımda
// sayılanla sınırlıdır ve tarih varsayılan olarak bugüne gelir.

export interface ActivityFormValues {
  id?: string;
  activityDate: string;
  title: string;
  description: string;
  targetDepartmentIds: string[];
  /** Taslaktan geliniyorsa kimliği; gönderim sonrası taslak silinsin diye. */
  draftId?: string;
  /** Taslakta ya da mevcut faaliyette daha önce kaydedilmiş ekler. */
  attachments?: AttachmentPickerItem[];
  openFollowUp?: boolean;
}

/**
 * Yarım kalmış metin şeridi (Görev 10.2).
 *
 * Metin **kendiliğinden geri gelmez**; kullanıcı ister. Sessizce doldurmak,
 * kullanıcının yazdığını sandığı şeyle ekrandaki şeyi ayrıştırır — özellikle
 * araya yeni bir kayıt girmişse.
 */
function DraftBanner({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      data-test="yarim-kalan"
      className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-sm) border border-waiting-line bg-waiting-soft px-3.5 py-3"
    >
      <p className="text-[length:var(--text-sm)] text-ink">
        <span className="font-medium">Yarım kalmış bir metniniz var.</span>{" "}
        <span className="text-muted">
          Bu cihazda {savedAtLabel(savedAt, new Date())} yazılmış. Bu kopyada
          yalnız metin bulunur; sunucu taslağındaki ekler ayrıca korunur.
        </span>
      </p>

      <span className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="primary" onClick={onRestore}>
          Geri getir
        </Button>
        <Button type="button" size="sm" onClick={onDiscard}>
          Sil
        </Button>
      </span>
    </div>
  );
}

export function ActivityForm({
  options,
  values,
  mode,
  draftKey,
  draftCount = 0,
  limits,
  attachmentLimits,
}: {
  options: TargetOption[];
  values: ActivityFormValues;
  mode: "create" | "edit";
  /**
   * Ek dosya sınırları; metin sınırlarıyla aynı gerekçeyle sunucudan geliyor
   * (bkz. `limits`). Kullanıcı reddedilmeden **önce** neyin kabul edildiğini
   * görmeli: sınırı bilmeden 80 MB'lık video yüklemeye çalışmak, dosyayı
   * gönderdikten sonra hata almak demekti.
   */
  attachmentLimits: { maxSizeBytes: number; maxCount: number };
  /**
   * Metin uzunluk sınırları; sunucudaki doğrulamayla **aynı** kaynaktan
   * geliyor (Görev 11.6). Ayrı okunsaydı form kabul ettiğini sunucu
   * reddederdi.
   */
  limits: ActivityTextLimits;
  /** Kullanıcının bekleyen taslak sayısı; yeni faaliyet ekranında hatırlatılır. */
  draftCount?: number;
  /**
   * Yarım kalmış metnin saklanacağı anahtar (Görev 10.2). Kullanıcıya özeldir:
   * ortak bir tarayıcıda birinin yazdığı metin diğerine teklif edilmemeli.
   */
  draftKey: string;
}) {
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createActivityAction : updateActivityAction,
    emptyActivityFormState,
  );

  // "Taslak olarak kaydet" formu göndermez; formdaki alanları okuyup taslak
  // eylemini **doğrudan** çağırır ve sonra Taslaklar sayfasına götürür.
  //
  // Neden `formAction` ile ikinci bir gönderim değil: aynı form hem faaliyet
  // eylemine hem taslak eylemine bağlanınca hangi düğmenin hangi eylemi
  // çalıştırdığı tarayıcıya ve React sürümüne kalıyor. Burada belirsizlik
  // olamaz — biri kaydı gönderiyor, diğeri göndermiyor.
  const router = useRouter();
  const [taslakHatasi, setTaslakHatasi] = useState<string | null>(null);
  const [taslakPending, setTaslakPending] = useState(false);

  // Seçim React durumunda tutulur: arama kutusu listeyi süzdüğü için ekranda
  // görünmeyen bir kutucuğun işaretli kalması gerekiyor. Forma giden değer
  // gizli alanlardan gidiyor; sunucu tarafı hiç değişmedi.
  const [secilen, setSecilen] = useState<string[]>(values.targetDepartmentIds);

  const { formRef, bekleyen, geriGetir, sil, gonderildi } = useActivityDraft(
    draftKey,
    {
      activityDate: values.activityDate,
      title: values.title,
      description: values.description,
      targetDepartmentIds: values.targetDepartmentIds,
    },
    setSecilen,
  );

  const sunucuTaslagi = useServerDraft(formRef, values.draftId ?? null, mode === "create");

  const taslakKaydet = async () => {
    const form = formRef.current;
    if (!form || taslakPending) return;

    setTaslakPending(true);
    setTaslakHatasi(null);

    const data = new FormData(form);
    data.set("draftId", sunucuTaslagi.draftId ?? "");
    data.set("savedManually", "1");

    try {
      const sonuc = await saveDraftAction(emptyDraftState, data);

      if (sonuc.error) {
        setTaslakHatasi(sonuc.error);
        return;
      }

      // Taslak kaydedildi: yerel kopya ve otomatik kaydetme durdurulur,
      // kullanıcı taslaklarına götürülür.
      sunucuTaslagi.gonderiliyor();
      sil();
      router.push("/drafts?kayit=taslak");
    } catch {
      setTaslakHatasi("Taslak kaydedilemedi. Bağlantınızı kontrol edin.");
    } finally {
      setTaslakPending(false);
    }
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      // Gönderim başlarken saklanan metin silinir: kayıt tamamlandıktan sonra
      // aynı metin yeniden teklif edilseydi mükerrer faaliyet üretirdi.
      // Doğrulama hatası dönerse metin ekranda durmaya devam eder ve ilk
      // dokunuşta yeniden saklanır.
      onSubmit={() => {
        gonderildi();
        sunucuTaslagi.gonderiliyor();
      }}
      className="flex flex-col gap-5"
    >
      {/* Taslaktan gelindiyse kimliği taşınır: faaliyet gönderilince taslak
          silinsin, listede kopyası kalmasın. */}
      <input
        type="hidden"
        name="draftId"
        value={sunucuTaslagi.draftId ?? ""}
      />

      {/* Bekleyen taslak hatırlatması: kullanıcı yeni bir kayıt yazmaya
          başlamadan önce, yarım bıraktığı bir şey olduğunu bilmeli. */}
      {mode === "create" && draftCount > 0 && !sunucuTaslagi.draftId ? (
        <p
          data-test="taslak-hatirlatma"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-sm) border border-line bg-inset px-3.5 py-2.5 text-[length:var(--text-sm)] text-muted"
        >
          <span>
            Gönderilmemiş <strong className="font-semibold text-ink">{draftCount}</strong>{" "}
            taslağınız var.
          </span>
          <a href="/drafts" className="text-primary underline-offset-4 hover:underline">
            Taslaklara git
          </a>
        </p>
      ) : null}
      {bekleyen ? (
        <DraftBanner
          savedAt={bekleyen.savedAt}
          onRestore={geriGetir}
          onDiscard={sil}
        />
      ) : null}

      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <FormGrid columns={2}>
        <Field htmlFor="activityDate" label="Tarih" required>
          <Input
            id="activityDate"
            name="activityDate"
            type="date"
            required
            defaultValue={values.activityDate}
          />
        </Field>

        <Field
          htmlFor="title"
          label="Başlık"
          required
          hint={
            limits.titleMin > 1 ? `En az ${limits.titleMin} karakter` : undefined
          }
        >
          <Input
            id="title"
            name="title"
            required
            minLength={limits.titleMin}
            maxLength={limits.titleMax}
            defaultValue={values.title}
            placeholder="Örn. 3 numaralı preste kalıp arızası ve çözümü"
          />
        </Field>
      </FormGrid>

      <Field
        htmlFor="description"
        label="Açıklama"
        hint="Yürütülen çalışma ve varılan tespitler; karşılaşılan bir sorun varsa ne olduğu ve nasıl çözüldüğü. Karar üst yönetime bırakılıyorsa bunu açıkça belirtin. Birkaç cümle yeterli — ayrıntı gerekirse bu kayıt üzerinden soru sorulur."
        required
      >
        <Textarea
          id="description"
          name="description"
          required
          rows={8}
          minLength={limits.descriptionMin}
          maxLength={limits.descriptionMax}
          defaultValue={values.description}
        />
        {limits.descriptionMin > 1 ? (
          <p className="mt-1 text-[length:var(--text-2xs)] text-faint">
            En az {limits.descriptionMin} karakter yazılmalı.
          </p>
        ) : null}
      </Field>

      <fieldset className="flex flex-col gap-2.5 rounded-(--radius-sm) border border-line bg-inset/40 p-3.5">
        <legend className="px-1 text-[length:var(--text-sm)] font-medium text-ink">
          İlgili departmanlar
        </legend>
        <p className="text-[length:var(--text-xs)] text-muted">
          Bu konu hangi departmanları ilgilendiriyor? En fazla{" "}
          {MAX_TARGET_DEPARTMENTS} departman seçebilirsiniz. Seçilen departmana
          erişim vermez.
        </p>

        <DepartmentPicker
          options={options}
          selected={secilen}
          onChange={setSecilen}
          max={MAX_TARGET_DEPARTMENTS}
        />
      </fieldset>

      {mode === "create" ? (
        <Checkbox
          name="openFollowUp"
          label="Bu konu açık kalsın"
          description="Takip maddesi açılır: sizin sorumluluğunuza girer ve kapatırken not yazarsınız. Zorunlu değildir."
        />
      ) : null}

      <Field htmlFor="files" label="Ekler (isteğe bağlı)">
        <AttachmentPicker
          existingAttachments={values.attachments}
          maxCount={attachmentLimits.maxCount}
          maxSizeBytes={attachmentLimits.maxSizeBytes}
        />
      </Field>

      <FormActions
        message={
          state.error || taslakHatasi ? (
            <div id="faaliyet-hatasi">
              <Alert tone="danger">{state.error ?? taslakHatasi}</Alert>
            </div>
          ) : null
        }
      >
        {/* "Kaydet" değil **"Gönder"**: kayıt kaydedildiği anda yöneticiye
            düşüyor ve kapsamdaki kişilere görünüyor. "Taslak olarak kaydet"
            ile arasındaki fark da tam olarak bu — biri gönderiyor, diğeri
            göndermiyor. */}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? mode === "create"
              ? "Gönderiliyor…"
              : "Kaydediliyor…"
            : mode === "create"
              ? "Gönder"
              : "Değişikliği kaydet"}
        </Button>

        {/* Taslak olarak kaydetmek **göndermek değildir**: kayıt kimseye
            düşmez, yalnız Taslaklar sayfasında bekler. */}
        {mode === "create" ? (
          <Button type="button" onClick={taslakKaydet} disabled={taslakPending}>
            {taslakPending ? "Kaydediliyor…" : "Taslak olarak kaydet"}
          </Button>
        ) : null}

        <ButtonLink href={values.id ? `/activities/${values.id}` : "/activities"}>
          Vazgeç
        </ButtonLink>

        {/* Otomatik kaydetmenin durumu. Sessiz kalmak, kullanıcının
            "kaydedildi mi acaba" diye tahmin etmesi demekti. */}
        {mode === "create" ? (
          <span
            role="status"
            aria-live="polite"
            data-test="taslak-durumu"
            className="text-[length:var(--text-xs)] text-faint"
          >
            {sunucuTaslagi.durum === "kaydediliyor"
              ? "Taslak kaydediliyor…"
              : sunucuTaslagi.durum === "kaydedildi"
                ? "Taslak kaydedildi"
                : sunucuTaslagi.durum === "hata"
                  ? "Taslak kaydedilemedi — bağlantınızı kontrol edin."
                  : ""}
          </span>
        ) : null}
      </FormActions>
    </form>
  );
}
