import Link from "next/link";

import { AuthLayout } from "@/components/shell/auth-layout";
import { getLocalizedMetadata, getTranslations } from "@/server/i18n/server";

import { RequestResetForm } from "./reset-forms";




export async function generateMetadata() {
  return getLocalizedMetadata("auth.passwordResetTitle");
}

export default async function ResetRequestPage() {
  const t = await getTranslations();
  return (
    <AuthLayout
      title={t("auth.passwordResetTitle")}
      description={t("auth.passwordResetDescription")}
      footer={
        <Link href="/login" className="text-primary hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      }
    >
      <RequestResetForm />
    </AuthLayout>
  );
}
