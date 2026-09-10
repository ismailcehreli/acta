import type { ReactNode } from "react";

/**
 * Oturum öncesi ekranların (giriş, parola sıfırlama, parola değiştirme) ortak
 * ayarı: **istek başına** üretilirler.
 *
 * Gerekçe: `AuthLayout` marka bilgisini (şirket adı, logo) veritabanından
 * okuyor. Bu ekranların derleme anında üretilmesi iki şeyi birden bozardı —
 * marka değişikliği ancak yeniden derlemeyle görünürdü ve **imaj, ayakta bir
 * veritabanı olmadan derlenemezdi.** İkincisi fiilen yaşandı: `/reset` statik
 * sayılıp derleme sırasında Prisma'yı çağırdığı için `docker build` üretim
 * imajını üretemiyordu (`Environment variable not found: DATABASE_URL`).
 */
export const dynamic = "force-dynamic";

export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
