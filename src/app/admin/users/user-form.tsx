"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";

import { createUserAction } from "./actions";
import { emptyUserFormState } from "./form-state";

// Kullanıcı ekleme (§4.6, §15.1). Dışarıdan kayıt kapalıdır: hesabı yalnızca
// sistem yöneticisi açar ve başlangıç parolasını güvenli bir yoldan iletir.

export interface UnitChoice {
  id: string;
  label: string;
}

export function UserForm({
  units,
  sistemYoneticisi,
}: {
  units: UnitChoice[];
  /**
   * Sistem yöneticisi mi bakıyor (Görev 11.7).
   *
   * Bölüm yöneticisi rol, bayrak ve parola belirleyemez. Kutuların
   * gizlenmesi bir **kolaylık**: asıl kural sunucuda, müdürün kendi
   * yolunda — o yol bu alanları istekten hiç okumuyor
   * (`mudurEklemesi`, `updateUserByManager`).
   */
  sistemYoneticisi: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    createUserAction,
    emptyUserFormState,
  );

  return (
    <Card>
      <CardHeader
        title="Yeni kullanıcı"
        description="Başlangıç parolasını kullanıcıya güvenli bir yoldan iletin; ilk girişten sonra kendisi değiştirebilir."
      />
      <CardBody>
        <form action={formAction} className="flex flex-col gap-5">
          <FormGrid>
            <Field htmlFor="fullName" label="Ad soyad" required>
              <Input id="fullName" name="fullName" required autoComplete="off" />
            </Field>

            <Field
              htmlFor="title"
              label="Unvan"
              hint="İsteğe bağlı. Örn. “Kalıphane Müdürü”. Yalnızca kim olduğunu anlatır; yetki vermez — görünürlük ve onay birim ağacından gelir."
            >
              <Input
                id="title"
                name="title"
                autoComplete="off"
                maxLength={100}
                placeholder="Örn. Üretim Planlama Uzmanı"
              />
            </Field>

            <Field htmlFor="email" label="E-posta" required>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="off"
              />
            </Field>

            <Field htmlFor="orgUnitId" label="Birim" required>
              <Select id="orgUnitId" name="orgUnitId" required defaultValue="">
                <option value="" disabled>
                  Birim seçin
                </option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </Field>

            {/* **Müdür parola belirleyemez** (tasarım, Paket F): müdürün
                bildiği parola, denetim izindeki "bu kaydı kim yazdı"
                cevabını zayıflatır. Müdürün açtığı hesapta parolayı
                kullanıcı, kendi e-postasına giden bağlantıyla kurar. */}
            {sistemYoneticisi ? (
              <Field htmlFor="initialPassword" label="Başlangıç parolası" required hint="En az 10 karakter">
                <Input
                  id="initialPassword"
                  name="initialPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </Field>
            ) : null}
          </FormGrid>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-ink">Roller</legend>
            {sistemYoneticisi ? (
              <>
                <Checkbox
                  name="isUnitManager"
                  label="Birim yöneticisi"
                  description="Kendi biriminin ve altındaki tüm birimlerin faaliyetlerini görür, onaylar ve düzeltme ister. Bir birimde birden fazla yönetici olabilir: kayıt hepsinin onay kuyruğunda görünür ve ilk karar veren süreci kapatır."
                />
                <Checkbox
                  name="isSystemAdmin"
                  label="Sistem yöneticisi"
                  description="Birim ağacını, kullanıcıları, çalışma takvimini ve sistem ayarlarını yönetir. Bu yetki faaliyet içeriğini görmeye yaramaz: sistem yöneticisi, yöneticisi olmadığı bir kişinin ne yazdığını okuyamaz."
                />
              </>
            ) : (
              <p className="text-[length:var(--text-sm)] text-muted">
                Birim yöneticisi ve sistem yöneticisi yetkilerini yalnız sistem
                yöneticisi verebilir.
              </p>
            )}
            {sistemYoneticisi ? (
              <>
                <Checkbox
                  name="isScored"
                  defaultChecked
                  label="Skoru hesaplansın"
                  description="Faaliyet yazan ama puanlanması anlamlı olmayan roller için kapatın: genel müdür, yeni başlayan ilk dönem, yarı zamanlı. Faaliyet yazmasını engellemez."
                />
                <Checkbox
                  name="canAppreciate"
                  label="Faaliyetlere takdir verebilir"
                  description="Bu kişi faaliyetlere takdir verebilir. Onaylanmış faaliyetlere verilen takdirler, skor ayarındaki puan kadar faaliyeti yazan kişinin genel puanına eklenir."
                />
                <Checkbox
                  name="canViewReports"
                  label="Yönetim raporlarını görebilir"
                  description="Bağlı olduğu birim ve alt birimleri için faaliyet, izin ve bildirim özetlerini görür. Raporlarda ham faaliyet metni veya bildirim içeriği gösterilmez."
                />
                <Checkbox
                  name="canViewScoreReports"
                  label="Skor ve takdir raporlarını görebilir"
                  description="Bağlı olduğu birim ve alt birimleri için skor ve takdir özetlerini görür. Bu seçenek tek başına genel rapor ekranını açmaz."
                />
              </>
            ) : null}
            {sistemYoneticisi ? (
            <Checkbox
              name="writesActivities"
              defaultChecked
              label="Günlük faaliyet yazar"
              description="İşaret kaldırılırsa bu kişiden faaliyet beklenmez: akşam hatırlatması gitmez ve katılım hesabına girmez. Yazmayı engellemez. Yönetim Kurulu üyeleri gibi roller için."
            />
            ) : null}
          </fieldset>

          {/* Hoş geldiniz e-postası. **Parola gönderilmez**: kullanıcıya
              sistemin adresi ve kendi giriş adresi bildirilir, parolayı
              kendisi belirlesin diye sıfırlama bağlantısı gider. Parolayı
              postaya koymak onu posta kutusunda ve yedeklerde süresiz
              bırakırdı. */}
          <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
            <legend className="text-sm font-medium text-ink">Bilgilendirme</legend>
            {/* Müdürün açtığı hesapta posta **zorunlu**, seçenek değil:
                parolayı kimse bilmiyor ve tek giriş yolu bu bağlantı. */}
            {sistemYoneticisi ? (
              <Checkbox
                name="sendWelcome"
                label="Kullanıcıya hoş geldiniz e-postası gönder"
                description="Sistemin adresini ve giriş adresini bildiren bir e-posta gider; parolasını kendisi belirlesin diye tek kullanımlık bağlantı içerir. Parola e-postayla gönderilmez. SMTP ayarlı değilse posta kuyrukta bekler."
              />
            ) : (
              <p className="text-[length:var(--text-sm)] text-muted">
                Kullanıcıya parola belirleme bağlantısı içeren bir e-posta
                gönderilecek. Parolayı siz belirleyemezsiniz; kişi kendi
                adresinden kendisi kurar.
              </p>
            )}
          </fieldset>

          <FormActions
            message={
              <>
                {state.error ? (
                  <div id="kullanici-hatasi">
                    <Alert tone="danger">{state.error}</Alert>
                  </div>
                ) : null}
                {state.success ? (
                  <div id="kullanici-basarili">
                    <Alert tone="success">{state.success}</Alert>
                  </div>
                ) : null}
              </>
            }
          >
            <Button type="submit" variant="primary" disabled={pending}>
              Kullanıcı ekle
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
