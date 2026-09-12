import Link from "next/link";

import { AuthLayout } from "@/components/shell/auth-layout";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { ResetPasswordForm } from "../reset-forms";





export async function generateMetadata() {
  return getLocalizedMetadata("auth.newPasswordPageTitle");
}

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations();

  return (
    <AuthLayout
      title={t("auth.newPasswordPageTitle")}
      description={t("auth.newPasswordPageDescription")}
      footer={
        <Link href="/login" className="text-primary hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      }
    >
      <ResetPasswordForm token={decodeURIComponent(token)} />
    </AuthLayout>
  );
}
