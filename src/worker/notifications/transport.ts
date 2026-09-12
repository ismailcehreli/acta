import { createTransport } from "nodemailer";





export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;

  readonly name: string;
}


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
 * Transport used when SMTP is not configured: it does not send email and
 * writes to the log. It keeps the queue path usable in development; the log
 * line explicitly says that the message was not sent.
 */
export function createLogTransport(
  log: (message: string) => void = console.log,
): EmailTransport {
  return {
    name: "log(SMTP not configured)",
    async send(message) {
      log(
        `[notification] SMTP not configured; not sent → ${message.to} · ${message.subject}`,
      );
    },
  };
}
