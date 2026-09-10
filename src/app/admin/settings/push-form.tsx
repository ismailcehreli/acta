"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";

import { saveVapidAction } from "./actions";
import { emptySettingsFormState } from "./form-state";

// Tarayıcı bildirimleri kurulumu (Görev 5.3b).
//
// Anahtar çifti bir kez üretilir ve **sabit kalmak zorundadır**: değişirse
// herkesin tarayıcısındaki abonelik geçersizleşir ve izinlerin yeniden
// verilmesi gerekir. Bu yüzden yenileme ayrı bir onay kutusuna bağlı.

export interface PushView {
  configured: boolean;
  publicKey: string;
  subject: string;
  /** Kaç cihaz abone; kurulumun işe yarayıp yaramadığının tek somut kanıtı. */
  subscriberCount: number;
}

export function PushForm({ view }: { view: PushView }) {
  const [state, formAction, pending] = useActionState(
    saveVapidAction,
    emptySettingsFormState,
  );

  return (
    <Card>
      <CardHeader
        title="Tarayıcı bildirimleri"
        description="Kullanıcılar kendi profil sayfalarından cihaz bazında açar. Bildirimde faaliyet içeriği taşınmaz; yalnız başlık ve bağlantı gider."
      />
      <CardBody>
        <form
          action={formAction}
          className="flex flex-col gap-4"
          data-test="push-kurulumu"
        >
          <p className="text-[length:var(--text-sm)] text-muted">
            {view.configured
              ? `Kurulu. Şu an ${view.subscriberCount} cihaz abone.`
              : "Henüz kurulmadı. Anahtar üretilmeden kimse bildirim alamaz."}
          </p>

          <Field
            htmlFor="vapidSubject"
            label="İletişim adresi"
            hint="Tarayıcı bildirimleri Google, Mozilla ve Apple'ın push sunucuları üzerinden gider. Web push standardı, bu sunucuların sorun çıktığında ulaşabileceği bir adres ister — örneğin sisteminiz aşırı bildirim gönderirse buraya yazarlar. Kullanıcılara gösterilmez. “mailto:” ile başlamalı."
            required
          >
            <Input
              id="vapidSubject"
              name="subject"
              defaultValue={view.subject}
              placeholder="mailto:bt@sirket.com"
              maxLength={200}
              required
            />
          </Field>

          {view.configured ? (
            // Yıkıcı işlem, zararsız olanla aynı düğmeye bağlanmaz: kutu
            // işaretlenmedikçe "Kaydet" yalnız adresi günceller.
            <div className="border-t border-line pt-4">
              <Checkbox
                name="replace"
                label="Anahtarları da yenile"
                description="Yalnızca özel anahtar sızdıysa işaretleyin. Mevcut bütün abonelikler geçersizleşir ve herkesin bildirim iznini yeniden vermesi gerekir. İletişim adresini değiştirmek için bu kutuya gerek yok."
              />
            </div>
          ) : null}

          <FormMessage error={state.error} success={state.success} />

          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? "Üretiliyor…"
                : view.configured
                  ? "Kaydet"
                  : "Anahtar üret ve kur"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
