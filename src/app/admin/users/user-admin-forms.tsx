"use client";

import { useActionState } from "react";

import type { ManagedUser } from "@/server/users/list";
import { Avatar } from "@/components/ui/avatar";
import { Alert, FormMessage } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/ui/page";
import { formatInstantShort } from "@/shared/format/date-time";

import {
  closeConversationsForUserAction,
  deactivateUserAction,
  reactivateUserAction,
  setUserPasswordAction,
  triggerPasswordResetAction,
  updateUserAction,
} from "./actions";
import { emptyUserFormState } from "./form-state";
import type { UnitChoice } from "./user-form";

type EditMode = "system-admin" | "unit-manager" | "root-self";

export function UserEditForm({
  user,
  units,
  mode,
}: {
  user: ManagedUser;
  units: UnitChoice[];
  mode: EditMode;
}) {
  const [state, formAction, pending] = useActionState(
    updateUserAction,
    emptyUserFormState,
  );
  const fullAccess = mode === "system-admin";
  const rootSelf = mode === "root-self";

  return (
    <Card>
      <CardHeader
        title={rootSelf ? "Ana hesap ayarları" : "Kullanıcı bilgileri"}
        description={
          rootSelf
            ? "Ana hesabın kimliği, sistem yöneticisi rolü ve aktiflik durumu korunur. Aşağıdaki seçenekler yalnızca hesabın çalışma biçimini belirler."
            : fullAccess
              ? "Bu hesabın iletişim, birim ve rol ayarlarını buradan güncelleyebilirsiniz."
              : "Birim yöneticisi olarak yalnızca ad ve unvanı güncelleyebilirsiniz."
        }
      />
      <CardBody>
        {rootSelf ? (
          <div className="mb-5">
            <Alert tone="info">
              Bu hesap korunur. Başka hiçbir kullanıcı hesabın adını, e-posta
              adresini, sistem yöneticisi rolünü veya aktiflik durumunu
              değiştiremez.
            </Alert>
          </div>
        ) : null}

        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="id" value={user.id} />

          <FormGrid columns={fullAccess ? 3 : 2}>
            {!rootSelf ? (
              <>
                <Field htmlFor="fullName" label="Ad soyad" required>
                  <Input
                    id="fullName"
                    name="fullName"
                    defaultValue={user.fullName}
                    required
                  />
                </Field>
                <Field htmlFor="title" label="Unvan">
                  <Input
                    id="title"
                    name="title"
                    defaultValue={user.title ?? ""}
                    maxLength={100}
                    placeholder="İsteğe bağlı"
                  />
                </Field>
              </>
            ) : null}

            {fullAccess ? (
              <>
                <Field htmlFor="email" label="E-posta" required>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={user.email}
                    required
                  />
                </Field>
                <Field htmlFor="orgUnitId" label="Birim" required>
                  <Select
                    id="orgUnitId"
                    name="orgUnitId"
                    defaultValue={user.orgUnitId}
                    required
                  >
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : null}

            {rootSelf ? (
              <Field htmlFor="orgUnitId" label="Bağlı olduğu birim" required>
                <Select
                  id="orgUnitId"
                  name="orgUnitId"
                  defaultValue={user.orgUnitId}
                  required
                >
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </FormGrid>

          {fullAccess || rootSelf ? (
            <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
              <legend className="text-sm font-medium text-ink">
                Çalışma seçenekleri
              </legend>

              {fullAccess ? (
                <>
                  <Checkbox
                    name="isUnitManager"
                    defaultChecked={user.isUnitManager}
                    label="Birim yöneticisi"
                  />
                  <Checkbox
                    name="isSystemAdmin"
                    defaultChecked={user.isSystemAdmin}
                    label="Sistem yöneticisi"
                  />
                </>
              ) : null}

              <Checkbox
                name="isScored"
                defaultChecked={user.isScored}
                label="Skoru hesaplansın"
              />
              <Checkbox
                name="canAppreciate"
                defaultChecked={user.canAppreciate}
                label="Takdir verebilir"
              />
              <Checkbox
                name="canViewReports"
                defaultChecked={user.canViewReports}
                label="Yönetim raporlarını görebilir"
                description="Rapor kapsamı, kullanıcının bağlı olduğu birim ve alt birimlerle sınırlıdır."
              />
              <Checkbox
                name="canViewScoreReports"
                defaultChecked={user.canViewScoreReports}
                label="Skor ve takdir raporlarını görebilir"
                description="Skor raporu ayrı bir yetkidir; rapor ekranındaki diğer özetleri etkilemez."
              />
              <Checkbox
                name="writesActivities"
                defaultChecked={user.writesActivities}
                label="Günlük faaliyet yazar"
              />
            </fieldset>
          ) : null}

          {!fullAccess && !rootSelf ? (
            <p className="border-t border-line pt-4 text-[length:var(--text-sm)] text-muted">
              Roller, skor ve faaliyet seçenekleri yalnızca sistem yöneticisi
              tarafından değiştirilebilir.
            </p>
          ) : null}

          <FormActions
            message={<FormMessage error={state.error} success={state.success} />}
          >
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}

function CloseConversationsForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    closeConversationsForUserAction,
    emptyUserFormState,
  );

  return (
    <form action={formAction} className="mt-3 flex max-w-xl flex-col gap-3">
      <input type="hidden" name="id" value={userId} />
      <Field htmlFor="close-reason" label="Kapatma gerekçesi" required>
        <Input id="close-reason" name="reason" required maxLength={500} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Açık konuşmaları kapat
      </Button>
      <FormMessage error={state.error} success={state.success} />
    </form>
  );
}

function DeactivateButton({
  user,
  canCloseConversations,
}: {
  user: ManagedUser;
  canCloseConversations: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    deactivateUserAction,
    emptyUserFormState,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Pasifleştiriliyor…" : "Hesabı pasifleştir"}
        </Button>
      </form>
      {state.error ? (
        <div className="max-w-xl text-[length:var(--text-sm)] text-danger" role="alert">
          <p>{state.error}</p>
          {state.blockers ? (
            <ul className="mt-2 ml-5 list-disc text-muted">
              {state.blockers.openConversationCount > 0 ? (
                <li>
                  {state.blockers.openConversationCount} açık konuşma var.
                  {canCloseConversations ? (
                    <CloseConversationsForm userId={user.id} />
                  ) : null}
                </li>
              ) : null}
              {state.blockers.subordinates.length > 0 ? (
                <li>
                  Önce şu kişilerin yöneticiliğini devredin: {" "}
                  {state.blockers.subordinates
                    .map((person) => person.fullName)
                    .join(", ")}
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReactivateButton({ user }: { user: ManagedUser }) {
  const [state, formAction, pending] = useActionState(
    reactivateUserAction,
    emptyUserFormState,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" disabled={pending}>
          {pending ? "Aktifleştiriliyor…" : "Hesabı aktifleştir"}
        </Button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

function PasswordForm({ user }: { user: ManagedUser }) {
  const [state, formAction, pending] = useActionState(
    setUserPasswordAction,
    emptyUserFormState,
  );

  return (
    <div className="border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-ink">Parolayı yenile</h3>
      <p className="mt-1 text-xs text-muted">
        Yeni parola mevcut oturumları kapatır. Parolanın kendisini kullanıcıya
        güvenli bir yoldan iletin.
      </p>
      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={user.id} />
        <Field htmlFor="new-password" label="Yeni parola" required hint="En az 10 karakter">
          <Input
            id="new-password"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Değiştiriliyor…" : "Parolayı değiştir"}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage error={state.error} success={state.success} />
      </div>
    </div>
  );
}

function ResetLinkButton({ user }: { user: ManagedUser }) {
  const [state, formAction, pending] = useActionState(
    triggerPasswordResetAction,
    emptyUserFormState,
  );

  return (
    <div className="border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-ink">Parola bağlantısı</h3>
      <p className="mt-1 text-xs text-muted">
        Kullanıcı kendi e-posta adresine gelen bağlantıyla yeni parolasını
        belirler.
      </p>
      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" disabled={pending}>
          {pending ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage error={state.error} success={state.success} />
      </div>
    </div>
  );
}

export function UserSecurityPanel({
  user,
  canSetPassword,
  canCloseConversations,
}: {
  user: ManagedUser;
  canSetPassword: boolean;
  canCloseConversations: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Hesap işlemleri"
        description="Aktiflik ve parola işlemleri ayrı tutulur; geçmiş kayıtlar silinmez."
      />
      <CardBody className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">Hesap durumu</p>
            <p className="mt-1 text-xs text-muted">
              {user.isActive
                ? "Kullanıcı sisteme giriş yapabilir."
                : "Kullanıcı sisteme giriş yapamaz; geçmiş kayıtları korunur."}
            </p>
          </div>
          {user.isActive ? (
            <DeactivateButton
              user={user}
              canCloseConversations={canCloseConversations}
            />
          ) : (
            <ReactivateButton user={user} />
          )}
        </div>

        {canSetPassword ? (
          <PasswordForm user={user} />
        ) : (
          <ResetLinkButton user={user} />
        )}
      </CardBody>
    </Card>
  );
}

export function UserIdentityCard({ user }: { user: ManagedUser }) {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-4">
        <Avatar user={user} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[length:var(--text-xl)] font-semibold text-ink">
              {user.fullName}
            </h2>
            {user.isRoot ? <Badge tone="primary">Ana sistem yöneticisi</Badge> : null}
            {!user.isActive ? <Badge tone="neutral">Pasif</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {[user.title, user.orgUnitName, user.email].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2 text-xs text-faint">
            {user.lastLoginAt
              ? `Son giriş: ${formatInstantShort(user.lastLoginAt)}`
              : "Henüz giriş yapmadı"}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
