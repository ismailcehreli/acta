"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/ui/alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { FormActions } from "@/components/ui/page";
import type { LegacyDemoOriginCandidate } from "@/server/demo/origin";

import {
  classifyLegacyDemoOriginsAction,
  installDemoAction,
  purgeDemoAction,
} from "./actions";
import { emptySettingsFormState } from "./form-state";

// Örnek (demo) veri yönetimi.
//
// Yeni kurulan bir sistemde ekranların çoğu boştur ve boş ekran, çalıştığını
// göstermez. Bu kart bir örnek şirket kurar: birimler, farklı yetkilerde
// kullanıcılar, onayın dört hâlindeki faaliyetler, açık ve cevaplanmış
// sorular, takip maddeleri, okundu bilgisi, bildirimler, izin işaretleri ve
// resmî tatiller.

export function DemoForm({
  installed,
  legacyOriginCandidates,
}: {
  installed: boolean;
  legacyOriginCandidates: LegacyDemoOriginCandidate[];
}) {
  const [kurState, kurAction, kurPending] = useActionState(
    async () => installDemoAction(),
    emptySettingsFormState,
  );
  const [silState, silAction, silPending] = useActionState(
    purgeDemoAction,
    emptySettingsFormState,
  );
  const [kokenState, kokenAction, kokenPending] = useActionState(
    classifyLegacyDemoOriginsAction,
    emptySettingsFormState,
  );
  const [silmeAcik, setSilmeAcik] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Örnek veri"
        description="Sistemi denemek ve ekranların dolu hâlini görmek için örnek bir şirket kurar: birimler, farklı yetkilerde kullanıcılar, onay bekleyen ve karara bağlanmış faaliyetler, sorular, takip maddeleri ve bildirimler."
      />
      <CardBody>
        <div className="flex flex-col gap-5">
          <div>
            <p className="prose-measure text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
              Kurulum <strong className="font-semibold text-ink">yalnızca eksik olanı</strong>{" "}
              ekler; mevcut verinize dokunmaz ve ikinci kez çalıştırmak
              zararsızdır. Örnek hesapların e-posta adresleri{" "}
              <span className="mono">@example.test</span> ile biter — gerçek
              kullanıcılarınızla karışmaz.
            </p>

            <form action={kurAction} className="mt-4">
              <FormActions
                message={<FormMessage error={kurState.error} success={kurState.success} />}
              >
                <Button type="submit" variant="primary" disabled={kurPending}>
                  {installed ? "Eksik örnek veriyi tamamla" : "Örnek veriyi yükle"}
                </Button>
              </FormActions>
            </form>
          </div>

          {installed ? (
            <div className="border-t border-line pt-5">
              <p className="section-label mb-2">Temizleme</p>
              <p className="prose-measure text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
                Örnek verinin tamamını kaldırır: <span className="mono">@example.test</span>{" "}
                hesapları ve yalnızca onlara bağlı kayıtlar. Örnek bir kayda
                gerçek veri bağlanmışsa (örneğin gerçek bir kullanıcı örnek bir
                faaliyete soru sorduysa) işlem <strong className="font-semibold text-ink">reddedilir</strong>{" "}
                ve hiçbir şey silinmez.
              </p>
              <p className="prose-measure mt-2 text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-muted">
                Ortak ayarlar <strong className="font-semibold text-ink">kalır</strong>: örnek veriyle
                birlikte gelen resmî tatiller ve onay gerekçeleri silinmez —
                bunlar örnek şirkete değil, sisteminizin yapılandırmasına
                aittir. Gerekmiyorsa Çalışma takvimi ve Onay gerekçeleri
                ekranlarından kaldırabilirsiniz.
              </p>

              {legacyOriginCandidates.length > 0 ? (
                <form action={kokenAction} className="mt-4 flex flex-col gap-4">
                  <Alert tone="correction" title="Eski kurulum: birim kökeni belirsiz">
                    Ad bir köken kanıtı değildir. Temizlik başlamadan önce her
                    birimin örnek kurulum tarafından mı oluşturulduğunu, yoksa
                    daha önce var olup yeniden mi kullanıldığını seçin. Yanlış
                    birimi “kurulum oluşturdu” diye işaretlemek o birimin
                    silinmesine izin verir.
                  </Alert>

                  <div className="flex flex-col gap-3">
                    {legacyOriginCandidates.map((birim) => (
                      <fieldset
                        key={birim.id}
                        className="rounded-(--radius-sm) border border-line bg-inset/40 p-3.5"
                      >
                        <legend className="px-1 text-[length:var(--text-sm)] font-semibold text-ink">
                          {birim.name}
                        </legend>
                        <input type="hidden" name="orgUnitId" value={birim.id} />
                        <p className="mb-2 text-[length:var(--text-xs)] text-muted">
                          Üst birim: {birim.parentName ?? "Yok"} · Kimlik:{" "}
                          <span className="mono break-all">{birim.id}</span>
                        </p>
                        <label className="flex min-h-(--spacing-touch) items-start gap-2.5 py-1 text-[length:var(--text-sm)]">
                          <input
                            type="radio"
                            name={`origin:${birim.id}`}
                            value="CREATED_BY_INSTALLER"
                            required
                            className="mt-1 size-4"
                          />
                          <span>
                            <span className="font-medium text-ink">
                              Örnek kurulum oluşturdu
                            </span>
                            <span className="block text-[length:var(--text-xs)] text-muted">
                              Temizlik bu birimi, boşaldığında siler.
                            </span>
                          </span>
                        </label>
                        <label className="flex min-h-(--spacing-touch) items-start gap-2.5 py-1 text-[length:var(--text-sm)]">
                          <input
                            type="radio"
                            name={`origin:${birim.id}`}
                            value="REUSED_EXISTING"
                            required
                            className="mt-1 size-4"
                          />
                          <span>
                            <span className="font-medium text-ink">
                              Önceden vardı, yeniden kullanıldı
                            </span>
                            <span className="block text-[length:var(--text-xs)] text-muted">
                              Temizlik demo kayıtlarını kaldırır, bu birimi korur.
                            </span>
                          </span>
                        </label>
                      </fieldset>
                    ))}
                  </div>

                  <FormActions
                    message={
                      <FormMessage
                        error={kokenState.error}
                        success={kokenState.success}
                      />
                    }
                  >
                    <Button type="submit" variant="primary" disabled={kokenPending}>
                      Köken kararlarını kaydet
                    </Button>
                  </FormActions>
                </form>
              ) : silmeAcik ? (
                <form action={silAction} className="mt-4 flex flex-col gap-4">
                  <Alert tone="danger">
                    Bu işlem geri alınamaz. Örnek veri silindikten sonra
                    yeniden yüklenirse kayıtlar yeni tarihlerle oluşur.
                  </Alert>

                  <Field
                    htmlFor="onay"
                    label="Onay"
                    hint="Silmeyi onaylamak için kutuya büyük harflerle SİL yazın."
                    required
                  >
                    <Input
                      id="onay"
                      name="onay"
                      autoComplete="off"
                      placeholder="SİL"
                      className="max-w-40"
                    />
                  </Field>

                  <FormActions
                    message={<FormMessage error={silState.error} success={silState.success} />}
                  >
                    <Button type="submit" variant="danger" disabled={silPending}>
                      Örnek veriyi sil
                    </Button>
                    <Button type="button" onClick={() => setSilmeAcik(false)}>
                      Vazgeç
                    </Button>
                  </FormActions>
                </form>
              ) : (
                <div className="mt-4">
                  <Button type="button" onClick={() => setSilmeAcik(true)}>
                    Örnek veriyi sil…
                  </Button>
                  <div className="mt-2">
                    <FormMessage error={silState.error} success={silState.success} />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
