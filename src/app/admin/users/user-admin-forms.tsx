"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "@/components/i18n";

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
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    updateUserAction,
    emptyUserFormState,
  );
  const fullAccess = mode === "system-admin";
  const rootSelf = mode === "root-self";

  return (
    <Card>
      <CardHeader
        title={rootSelf ? t("screens.users.accountSettings") : t("screens.users.userInformation")}
        description={
          rootSelf
            ? t("screens.users.accountSettingsDescription")
            : fullAccess
              ? t("screens.users.userInformationDescription")
              : t("screens.users.managerDescription")
        }
      />
      <CardBody>
        {rootSelf ? (
          <div className="mb-5">
            <Alert tone="info">
              {t("screens.users.protectedAccount")}
            </Alert>
          </div>
        ) : null}

        <form action={formAction} className="flex flex-col gap-5" data-test="user-edit-form">
          <input type="hidden" name="id" value={user.id} />

          <FormGrid columns={fullAccess ? 3 : 2}>
            {!rootSelf ? (
              <>
                <Field htmlFor="fullName" label={t("screens.users.fullName")} required>
                  <Input
                    id="fullName"
                    name="fullName"
                    defaultValue={user.fullName}
                    required
                  />
                </Field>
                <Field htmlFor="title" label={t("screens.users.title")}>
                  <Input
                    id="title"
                    name="title"
                    defaultValue={user.title ?? ""}
                    maxLength={100}
                    placeholder={t("screens.users.optional")}
                  />
                </Field>
              </>
            ) : null}

            {fullAccess ? (
              <>
                <Field htmlFor="email" label={t("common.email")} required>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={user.email}
                    required
                  />
                </Field>
                <Field htmlFor="orgUnitId" label={t("screens.users.unit")} required>
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
              <Field htmlFor="orgUnitId" label={t("screens.users.unit")} required>
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
                {t("screens.users.workOptions")}
              </legend>

              {fullAccess ? (
                <>
                  <Checkbox
                    name="isUnitManager"
                    defaultChecked={user.isUnitManager}
                    label={t("screens.users.unitManager")}
                  />
                  <Checkbox
                    name="isSystemAdmin"
                    defaultChecked={user.isSystemAdmin}
                    label={t("screens.users.systemAdministrator")}
                  />
                </>
              ) : null}

              <Checkbox
                name="isScored"
                defaultChecked={user.isScored}
                label={t("screens.users.includeInScoring")}
              />
              <Checkbox
                name="canAppreciate"
                defaultChecked={user.canAppreciate}
                label={t("screens.users.canAppreciate")}
              />
              <Checkbox
                name="canViewReports"
                defaultChecked={user.canViewReports}
                label={t("screens.users.canViewReports")}
                description={t("screens.users.canViewReportsDescription")}
              />
              <Checkbox
                name="canViewScoreReports"
                defaultChecked={user.canViewScoreReports}
                label={t("screens.users.canViewScoreReports")}
                description={t("screens.users.canViewScoreReportsDescription")}
              />
              <Checkbox
                name="writesActivities"
                defaultChecked={user.writesActivities}
                label={t("screens.users.writesActivities")}
              />
            </fieldset>
          ) : null}

          {!fullAccess && !rootSelf ? (
            <p className="border-t border-line pt-4 text-[length:var(--text-sm)] text-muted">
              {t("screens.users.managerOnlyOptions")}
            </p>
          ) : null}

          <FormActions
            message={<FormMessage error={state.error} success={state.success} />}
          >
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("screens.users.saving") : t("screens.users.saveChanges")}
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}

function CloseConversationsForm({ userId }: { userId: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    closeConversationsForUserAction,
    emptyUserFormState,
  );

  return (
    <form action={formAction} className="mt-3 flex max-w-xl flex-col gap-3">
      <input type="hidden" name="id" value={userId} />
      <Field htmlFor="close-reason" label={t("screens.users.closeReason")} required>
        <Input id="close-reason" name="reason" required maxLength={500} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {t("screens.users.closeOpenConversations")}
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
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    deactivateUserAction,
    emptyUserFormState,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? t("screens.users.deactivating") : t("screens.users.deactivate")}
        </Button>
      </form>
      {state.error ? (
        <div className="max-w-xl text-[length:var(--text-sm)] text-danger" role="alert">
          <p>{state.error}</p>
          {state.blockers ? (
            <ul className="mt-2 ml-5 list-disc text-muted">
              {state.blockers.openConversationCount > 0 ? (
                <li>
                  {t("screens.users.openConversationCount", { count: state.blockers.openConversationCount })}
                  {canCloseConversations ? (
                    <CloseConversationsForm userId={user.id} />
                  ) : null}
                </li>
              ) : null}
              {state.blockers.subordinates.length > 0 ? (
                <li>
                  {t("screens.users.transferManagers", {
                    users: state.blockers.subordinates.map((person) => person.fullName).join(", "),
                  })}
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
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    reactivateUserAction,
    emptyUserFormState,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" disabled={pending}>
          {pending ? t("screens.users.activating") : t("screens.users.activate")}
        </Button>
      </form>
      <FormMessage error={state.error} success={state.success} />
    </div>
  );
}

function PasswordForm({ user }: { user: ManagedUser }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    setUserPasswordAction,
    emptyUserFormState,
  );

  return (
    <div className="border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-ink">{t("screens.users.renewPassword")}</h3>
      <p className="mt-1 text-xs text-muted">{t("screens.users.passwordDescription")}</p>
      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={user.id} />
        <Field htmlFor="new-password" label={t("screens.users.newPassword")} required hint={t("screens.users.passwordHint")}>
          <Input
            id="new-password"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("screens.users.changing") : t("screens.users.changePassword")}
        </Button>
      </form>
      <div className="mt-3">
        <FormMessage error={state.error} success={state.success} />
      </div>
    </div>
  );
}

function ResetLinkButton({ user }: { user: ManagedUser }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    triggerPasswordResetAction,
    emptyUserFormState,
  );

  return (
    <div className="border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-ink">{t("screens.users.passwordLink")}</h3>
      <p className="mt-1 text-xs text-muted">{t("screens.users.passwordLinkDescription")}</p>
      <form action={formAction} className="mt-3">
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" disabled={pending}>
          {pending ? t("screens.users.sending") : t("screens.users.sendResetLink")}
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
  const t = useTranslations();
  return (
    <Card>
      <CardHeader
        title={t("screens.users.accountActions")}
        description={t("screens.users.securityDescription")}
      />
      <CardBody className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">{t("screens.users.accountStatus")}</p>
            <p className="mt-1 text-xs text-muted">
              {user.isActive
                ? t("screens.users.canSignIn")
                : t("screens.users.cannotSignIn")}
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
  const locale = useLocale();
  const t = useTranslations();
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-4">
        <Avatar user={user} size={72} locale={locale} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[length:var(--text-xl)] font-semibold text-ink">
              {user.fullName}
            </h2>
            {user.isRoot ? <Badge tone="primary">{t("screens.users.primarySystemAdministrator")}</Badge> : null}
            {!user.isActive ? <Badge tone="neutral">{t("screens.users.inactive")}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {[user.title, user.orgUnitName, user.email].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2 text-xs text-faint">
            {user.lastLoginAt
              ? t("screens.users.lastSignInAt", { date: formatInstantShort(user.lastLoginAt, locale) })
              : t("screens.users.neverSignedIn")}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
