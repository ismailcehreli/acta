import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  readNumericSetting,
  SETTING_KEYS,
} from "@/server/settings/system-settings";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Alert } from "@/components/ui/alert";

import { LoginForm } from "./login-form";

export const metadata = { title: "Giriş" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ parola?: string }>;
}) {
  // Girişli kullanıcı giriş ekranını görmez.
  if (await getCurrentUser()) {
    redirect("/");
  }

  const { parola } = await searchParams;

  // "Beni hatırla" süresi sistem ayarından; 0 ise kutu hiç çizilmez.
  const hatirlaGun = await readNumericSetting(
    prisma,
    SETTING_KEYS.rememberMeDays,
  );

  return (
    <AuthLayout
      title="Giriş yap"
      description="Şirket e-posta adresiniz ve parolanızla."
      footer={
        <Link href="/reset" className="text-primary hover:underline">
          Parolamı unuttum
        </Link>
      }
    >
      {parola === "degisti" ? (
        <div id="parola-degisti" role="status" className="mb-4">
          <Alert tone="success">Parolanız değiştirildi. Yeni parolanızla giriş yapın.</Alert>
        </div>
      ) : null}

      <LoginForm rememberDays={hatirlaGun} />
    </AuthLayout>
  );
}
