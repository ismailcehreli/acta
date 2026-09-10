import Link from "next/link";

import { AuthLayout } from "@/components/shell/auth-layout";

import { RequestResetForm } from "./reset-forms";

// Parola sıfırlama isteği (§15.3). Ekran oturum gerektirmez: parolasını
// unutmuş kullanıcı zaten giriş yapamıyor.

export const metadata = { title: "Parola sıfırlama" };

export default function ResetRequestPage() {
  return (
    <AuthLayout
      title="Parola sıfırlama"
      description="E-posta adresinizi yazın; kayıtlıysa sıfırlama bağlantısı gönderilir."
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Giriş ekranına dön
        </Link>
      }
    >
      <RequestResetForm />
    </AuthLayout>
  );
}
