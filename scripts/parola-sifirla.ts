import { PrismaClient } from "@prisma/client";

import { setUserPassword } from "@/server/users/update";
import { passwordSchema } from "@/shared/schemas/auth";

// Sunucudan parola sıfırlama (§15.3).
//
// **Ne zaman gerekir:** sistemde tek sistem yöneticisi varsa ve o kişi
// giremiyorsa. Normal yol iki tanedir ve ikisi de bundan iyidir:
//
//   1. Kullanıcı giriş ekranından "Parolamı unuttum" der; bağlantı e-postayla
//      gelir. SMTP ayarlıysa bu yol her zaman çalışır.
//   2. Başka bir sistem yöneticisi Yönetim → Kullanıcılar ekranından parola
//      belirler.
//
// Bu betik son çaredir: sunucuya kök erişimi olan biri, e-posta yolu
// çalışmadığında hesabı açabilsin diye.
//
// **Parola argüman olarak alınmaz.** Komut satırı argümanları süreç
// listesinde (`ps`) ve kabuk geçmişinde görünür. Değer ortam değişkeninden
// okunur.
//
// Kullanım:
//   RESET_EMAIL=kisi@sirket.com RESET_PASSWORD='...' \
//     node --import tsx scripts/parola-sifirla.ts
//
// İşlem gerçek servisten geçer (`setUserPassword`): parola Argon2id ile
// özetlenir, **açık oturumların tamamı kapanır**, hesap kilidi açılır ve
// denetim izine kayıt düşer. Doğrudan veritabanına yazmak bunların hiçbirini
// yapmazdı.

const EMAIL = process.env.RESET_EMAIL ?? "";
const PASSWORD = process.env.RESET_PASSWORD ?? "";

function log(message: string): void {
  console.log(`[parola] ${message}`);
}

async function main(): Promise<void> {
  if (EMAIL === "" || PASSWORD === "") {
    log("RESET_EMAIL ve RESET_PASSWORD ortam değişkenleri gerekli.");
    log("Örnek: RESET_EMAIL=kisi@sirket.com RESET_PASSWORD='...' pnpm parola:sifirla");
    process.exitCode = 1;
    return;
  }

  const kural = passwordSchema.safeParse(PASSWORD);
  if (!kural.success) {
    log(kural.error.issues[0]?.message ?? "Parola kuralı sağlanmadı.");
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient();

  try {
    const kisi = await db.user.findUnique({
      where: { email: EMAIL.trim().toLowerCase() },
      select: { id: true, fullName: true, isActive: true },
    });

    if (!kisi) {
      log(`Kullanıcı bulunamadı: ${EMAIL}`);
      process.exitCode = 1;
      return;
    }

    // Pasif hesabın parolasını değiştirmek işe yaramaz: giriş yine reddedilir.
    // Sessizce "başarılı" demek, kullanıcıyı boş yere uğraştırırdı.
    if (!kisi.isActive) {
      log(`Hesap pasif: ${EMAIL}. Önce Yönetim ekranından aktifleştirilmeli.`);
      process.exitCode = 1;
      return;
    }

    const sonuc = await setUserPassword(db, kisi.id, PASSWORD, new Date());

    if (!sonuc.ok) {
      log(`Parola belirlenemedi: ${sonuc.message}`);
      process.exitCode = 1;
      return;
    }

    log(`Parola değiştirildi: ${kisi.fullName} <${EMAIL}>`);
    log("Bu kullanıcının açık bütün oturumları kapatıldı; yeniden giriş gerekir.");
    log("Varsa hesap kilidi de açıldı.");
  } finally {
    await db.$disconnect();
  }
}

main();
