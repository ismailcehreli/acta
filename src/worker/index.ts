// Arka plan işleyici süreci (tasarım §17.2): hatırlatmalar ve bildirim kuyruğu
// web sürecinden ayrı çalışır ki biri diğerinin yükünü etkilemesin.
//
// Bildirim kuyruğu Görev 5.3a'da, hatırlatmalar Görev 5.4b'de, iş izleme
// Görev 5.6'da bağlandı.
//
// Her adım kendi nabzını yazar (§12.4): bir adım hata verse bile diğerleri
// çalışmaya devam eder ve hangisinin durduğu ekrandan görünür.

import { prisma } from "@/server/db";
import {
  JOB_NAMES,
  recordJobFailure,
  recordJobSuccess,
  type JobName,
} from "@/server/jobs/status";
import { readSmtpSettings } from "@/server/settings/smtp";

import { alertOnDelayedJobs } from "./jobs/alert";

import { dispatchNotifications } from "./notifications/dispatcher";
import { dispatchPushNotifications } from "./notifications/push";
import { webPushTransport } from "./notifications/push-transport";
import {
  createLogTransport,
  createSmtpTransport,
  type EmailTransport,
} from "./notifications/transport";
import { sendMissingActivityReminders } from "./reminders/no-activity";
import { drainScorePeriodWork } from "@/server/scoring/close-period";
import { sendOverdueAnswerReminders } from "./reminders/overdue-answers";
import { sendOverdueApprovalReminders } from "./reminders/overdue-approvals";

const TICK_INTERVAL_MS = Number(process.env.WORKER_TICK_INTERVAL_MS ?? 60_000);
const BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

// Taşıyıcı her turda ayarlardan kurulur ki BT sorumlusu ekrandan SMTP
// bilgisini değiştirdiğinde işleyiciyi yeniden başlatmak gerekmesin. Ayarlar
// değişmediyse aynı taşıyıcı kullanılır; her turda yeni bağlantı havuzu
// açmanın anlamı yok.
let transport: EmailTransport = createLogTransport();
let transportImzasi = "";

async function tasiyiciyiGuncelle(): Promise<void> {
  const smtp = await readSmtpSettings(prisma);
  const imza = smtp ? JSON.stringify(smtp) : "";

  if (imza === transportImzasi) return;

  transportImzasi = imza;
  // SMTP ayarlanmadıysa posta **gönderilmez** ve bu her denemede günlüğe
  // yazılır; sessizce gönderilmiş sayılmaz (§12.3).
  transport = smtp ? createSmtpTransport(smtp) : createLogTransport();
  log(`e-posta taşıyıcısı: ${transport.name}`);
}

let stopping = false;
/** Bekleyen uykuyu erken bitirir; kapanma sinyalinde kullanılır. */
let interruptSleep: (() => void) | null = null;

function log(message: string): void {
  console.log(`[worker] ${new Date().toISOString()} ${message}`);
}

/**
 * Bir adımı çalıştırır ve nabzını yazar. Adımın hata vermesi turu bitirmez:
 * hata kaydedilir, sonraki adımlar çalışır ve arıza ekrandan görünür (§12.4).
 */
async function adim<T>(
  jobName: JobName,
  calistir: () => Promise<T>,
): Promise<T | null> {
  try {
    const sonuc = await calistir();
    await recordJobSuccess(prisma, jobName, new Date());
    return sonuc;
  } catch (error) {
    const mesaj = error instanceof Error ? error.message : String(error);
    log(`${jobName} hatası: ${mesaj}`);
    await recordJobFailure(prisma, jobName, mesaj);
    return null;
  }
}

async function tick(): Promise<void> {
  const now = new Date();

  await tasiyiciyiGuncelle();

  // Önce hatırlatmalar kuyruğa yazılır, sonra kuyruk gönderilir: aynı turda
  // üretilen hatırlatma aynı turda yola çıksın.
  const eksikFaaliyet = await adim(JOB_NAMES.missingActivityReminder, () =>
    sendMissingActivityReminders(prisma, now),
  );
  if (eksikFaaliyet && eksikFaaliyet.queued > 0) {
    log(
      `hatırlatma: ${eksikFaaliyet.queued} kişiye "bugün faaliyet yok" ` +
        `(${eksikFaaliyet.skippedHasActivity} kişi girmiş, ` +
        `${eksikFaaliyet.skippedNoActivityMark} kişi izinli)`,
    );
  }

  const cevapsiz = await adim(JOB_NAMES.overdueAnswerReminder, () =>
    sendOverdueAnswerReminders(prisma, now),
  );
  if (cevapsiz && cevapsiz.queued > 0) {
    log(
      `hatırlatma: ${cevapsiz.overdueConversations} cevapsız konuşma, ` +
        `${cevapsiz.queued} bildirim` +
        (cevapsiz.managerNotFound > 0
          ? ` (${cevapsiz.managerNotFound} kişinin yöneticisi bulunamadı)`
          : ""),
    );
  }

  // Kapanan dönemin skoru saklanır: trend ve düşüş işareti geçmişe bakıyor,
  // canlı hesap yalnız içinde bulunulan dönemi biliyor (Görev 11.11).
  const skorDonemi = await adim(JOB_NAMES.scorePeriodClose, () =>
    drainScorePeriodWork(prisma, now),
  );
  if (skorDonemi && skorDonemi.processed > 0) {
    log(
      `skor: ${skorDonemi.processed} iş, ${skorDonemi.written} karne sürümü ` +
        `(${skorDonemi.periodStarts.join(", ")})`,
    );
  }

  const gecikenOnay = await adim(JOB_NAMES.overdueApprovalReminder, () =>
    sendOverdueApprovalReminders(prisma, now),
  );
  if (gecikenOnay && gecikenOnay.queued > 0) {
    log(
      `hatırlatma: ${gecikenOnay.overdue} geciken onay, ` +
        `${gecikenOnay.queued} bildirim`,
    );
  }

  const result = await adim(JOB_NAMES.notificationDispatch, () =>
    dispatchNotifications(prisma, transport, { now, baseUrl: BASE_URL }),
  );

  // Push ayrı bir adımdır: posta sunucusu çökse de bildirim gitmeli, tersi de
  // geçerli. İki kanalın birbirini düşürmemesi için kuyruk kayıtları da ayrı.
  const push = await adim(JOB_NAMES.pushDispatch, () =>
    dispatchPushNotifications(prisma, webPushTransport, {
      now,
      baseUrl: BASE_URL,
    }),
  );
  if (push && push.sent > 0) {
    log(
      `push: ${push.sent} gönderim, ${push.delivered} bildirim, ` +
        `${push.droppedSubscriptions} ölü abonelik düşürüldü`,
    );
  }

  // Gecikme alarmı turun **sonunda** kontrol edilir: bu turda çalışan adımlar
  // nabızlarını çoktan yazmış olur, yoksa süreç her açılışta kendine "hiç
  // çalışmadın" alarmı gönderirdi. Alarm kuyruğa yazılır ve bir sonraki turda
  // yola çıkar.
  //
  // **Sınır:** işleyici tümüyle ölürse bu alarm da gönderilemez. O durumu
  // yakalayan şey dış izlemedir — `/api/health` zamanlayıcı gecikmesini
  // döndürür ve gecikme eşiği aşılınca "down" der (§12.4). Buradaki alarm,
  // "süreç ayakta ama bir adım takılmış" durumu içindir.
  const alarm = await alertOnDelayedJobs(prisma, new Date());
  if (alarm.delayedJobs.length > 0) {
    log(
      `gecikmiş iş: ${alarm.delayedJobs.join(", ")} · ${alarm.queued} alarm yazıldı`,
    );
  }

  // Sessiz tur diye bir şey yok: iş yapıldıysa sayılar, yapılmadıysa nabız
  // yazılır. Zamanlayıcının çalıştığı günlükten anlaşılmalı (§12.4).
  if (result && result.sent + result.failed + result.givenUp > 0) {
    log(
      `bildirim: ${result.sent} e-posta, ${result.delivered} kayıt gönderildi, ` +
        `${result.failed} hata, ${result.givenUp} vazgeçildi`,
    );
  } else {
    log("nabız");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      interruptSleep = null;
      resolve();
    }, ms);

    interruptSleep = () => {
      clearTimeout(timer);
      interruptSleep = null;
      resolve();
    };
  });
}

async function main(): Promise<void> {
  log(`başladı (aralık: ${TICK_INTERVAL_MS} ms)`);

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      // Tek bir tur hata verse de süreç ölmemeli; hata görünür olmalı.
      log(`tur hatası: ${error instanceof Error ? error.message : error}`);
    }

    if (stopping) break;
    await sleep(TICK_INTERVAL_MS);
  }

  log("durdu");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal} alındı, kapanılıyor`);
    stopping = true;
    interruptSleep?.();
  });
}

main().catch((error) => {
  log(`ölümcül hata: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
