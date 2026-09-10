import { createTransport } from "nodemailer";

// E-posta taşıyıcısı (§12.3). Arayüz dar tutuldu: gönderim ayrıntısı
// işleyicinin bilmesi gereken bir şey değil, testler de sahte bir taşıyıcıyla
// koşabilsin diye.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
  /** Günlüğe yazılan ad; hangi taşıyıcının çalıştığı görünür olsun. */
  readonly name: string;
}

/**
 * Taşıyıcının ihtiyaç duyduğu ayarlar. Nereden geldiği (veritabanı ya da
 * ortam) burayı ilgilendirmez; okuma `server/settings/smtp.ts` içindedir.
 */
export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export function createSmtpTransport(settings: SmtpSettings): EmailTransport {
  const transporter = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user
      ? { user: settings.user, pass: settings.password }
      : undefined,
  });

  return {
    name: `smtp(${settings.host}:${settings.port})`,
    async send(message) {
      await transporter.sendMail({
        from: settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/**
 * SMTP ayarlanmadığında kullanılan taşıyıcı: postayı **göndermez**, günlüğe
 * yazar. Kuyruk yolunun geliştirmede de çalışması için var; ürettiği satır
 * "gönderilmedi" demeyi açıkça içerir ki kimse gerçek gönderim sanmasın.
 */
export function createLogTransport(
  log: (message: string) => void = console.log,
): EmailTransport {
  return {
    name: "log(SMTP ayarlı değil)",
    async send(message) {
      log(
        `[bildirim] SMTP ayarlı değil, gönderilmedi → ${message.to} · ${message.subject}`,
      );
    },
  };
}
