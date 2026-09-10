import Link from "next/link";

import { AuthLayout } from "@/components/shell/auth-layout";

import { ResetPasswordForm } from "../reset-forms";

// Yeni parola ekranı (§15.3). Belirteç burada **doğrulanmaz**: geçerliliğini
// söylemek, hangi bağlantının işe yaradığını denemeye açardı. Karar, parola
// yazıldıktan sonra sunucuda verilir.

export const metadata = { title: "Yeni parola" };

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthLayout
      title="Yeni parola"
      description="Değişiklikten sonra açık oturumlarınız kapanır."
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Giriş ekranına dön
        </Link>
      }
    >
      <ResetPasswordForm token={decodeURIComponent(token)} />
    </AuthLayout>
  );
}
