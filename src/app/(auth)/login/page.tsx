import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";
import { prisma } from "@/server/db";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Alert } from "@/components/ui/alert";

import { LoginForm } from "./login-form";

export async function generateMetadata() {
  return getLocalizedMetadata("auth.signIn");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string }>;
}) {

  if (await getCurrentUser()) {
    redirect("/");
  }

  const { passwordChanged } = await searchParams;
  const t = await getTranslations();


  const rememberDay = await readNumericSetting(
    prisma,
    SETTING_KEYS.rememberMeDays,
  );

  return (
    <AuthLayout
      title={t("auth.signIn")}
      description={t("auth.loginSubtitle")}
      footer={
        <Link href="/reset" className="text-primary hover:underline">
          {t("auth.forgotPassword")}
        </Link>
      }
    >
      {passwordChanged === "1" ? (
        <div id="password-changed" role="status" className="mb-4">
          <Alert tone="success">{t("auth.passwordChanged")}</Alert>
        </div>
      ) : null}

      <LoginForm rememberDays={rememberDay} />
    </AuthLayout>
  );
}
