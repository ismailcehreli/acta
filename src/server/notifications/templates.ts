import { NOTIFICATION_EVENTS, isKnownEvent } from "./events";
import { formatJobLag, jobLabel } from "@/server/jobs/labels";

// E-posta metinleri (§12.3, §17.5: arayüz Türkçe). Şablonlar sunucuda tek
// yerde durur; kuyruk kaydı yalnız olay adını ve gerekli değişkenleri taşır.
//
// İçerik bilerek **azdır**: e-posta faaliyetin kendisini taşımaz, sisteme
// çağırır. Görünürlük kararı e-postada verilemez — kuyruk yazıldığı andaki
// yetki, e-posta okunduğunda değişmiş olabilir.

export interface NotificationLine {
  /** Tek satırlık özet; toplu e-postada madde olarak dizilir. */
  summary: string;
  /** Sisteme dönüş adresi (uygulama köküne göre). */
  path: string;
}

interface Payload {
  activityId?: unknown;
  conversationId?: unknown;
  activityTitle?: unknown;
  reason?: unknown;
  token?: unknown;
  jobName?: unknown;
  lagMinutes?: unknown;
  /** "Faaliyet beklenmiyor" bildirimi için (Görev 11.8). */
  personName?: unknown;
  range?: unknown;
  approverName?: unknown;
  decisionRoute?: unknown;
  feedbackTitle?: unknown;
  feedbackStatus?: unknown;
  /** Faaliyet silme onay kodu ve silinecek kaydın başlığı (03.09.2026). */
  code?: unknown;
  title?: unknown;
}

function metin(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function faaliyetYolu(payload: Payload): string {
  const id = payload.activityId;
  return typeof id === "string" ? `/activities/${id}` : "/";
}

/**
 * Olayın tek satırlık karşılığı. Bilinmeyen olay **sessizce atlanmaz**: adı
 * yazılır ve kullanıcı sisteme yönlendirilir; aksi hâlde bildirim gönderilmiş
 * ama içi boş olurdu.
 */
export function renderLine(eventType: string, payload: unknown): NotificationLine {
  const data = (payload ?? {}) as Payload;
  const baslik = metin(data.activityTitle, "bir faaliyet");

  if (!isKnownEvent(eventType)) {
    return {
      summary: `Sistemde bir gelişme var (${eventType}).`,
      path: "/",
    };
  }

  switch (eventType) {
    case NOTIFICATION_EVENTS.questionAsked:
      return {
        summary: "Bir faaliyetiniz hakkında soru soruldu; cevabınız bekleniyor.",
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.answerReceived:
      return {
        summary: "Sorduğunuz soruya cevap geldi.",
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.activityCancelled:
      return {
        summary: `"${baslik}" iptal edildi; ilgili konuşma kapandı.`,
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.approvalPending:
      return {
        summary: "Onayınızı bekleyen bir faaliyet var.",
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.activityApproved:
      return {
        summary: `"${baslik}" onaylandı.`,
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.changesRequested:
      return {
        // Gerekçe metni e-postaya **girmez**: içerik postada taşınmaz (§12.3),
        // kişi ekranda okur.
        summary: `"${baslik}" için düzeltme istendi.`,
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.activityRejected:
      return {
        // Gerekçe ekranda okunur; postada içerik taşınmaz (§12.3).
        summary: `"${baslik}" uygun bulunmadı.`,
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.approvalOverdue:
      return {
        summary: "Onayınızı bekleyen bir kayıt gecikti.",
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.answerOverdue:
      return {
        summary: "Cevap bekleyen bir soru belirlenen süreyi aştı.",
        path: faaliyetYolu(data),
      };
    case NOTIFICATION_EVENTS.noActivityToday:
      return {
        summary: "Bugün için faaliyet girmediniz.",
        path: "/activities/new",
      };
    case NOTIFICATION_EVENTS.managerNotFound:
      return {
        summary: `"${baslik}" için yönetici bulunamadı; kayıt beklemede.`,
        path: "/",
      };
    case NOTIFICATION_EVENTS.jobDelayed: {
      const isAdi = typeof data.jobName === "string" ? jobLabel(data.jobName) : "bir iş";
      const gecikme = formatJobLag(
        typeof data.lagMinutes === "number" ? data.lagMinutes : null,
      );
      return {
        summary:
          `"${isAdi}" ${gecikme} çalışmadı. Hatırlatmalar ve bildirimler gecikiyor olabilir.`,
        path: "/admin/jobs",
      };
    }
    case NOTIFICATION_EVENTS.accountCreated: {
      const token = typeof data.token === "string" ? data.token : "";
      return {
        summary:
          "Faaliyet Raporlama Sistemi'nde hesabınız açıldı. Giriş adresiniz " +
          "kurum e-posta adresinizdir. Parolanızı belirlemek için aşağıdaki " +
          "bağlantıyı kullanın; bağlantı bir saat geçerlidir.",
        path: `/reset/${encodeURIComponent(token)}`,
      };
    }
    case NOTIFICATION_EVENTS.absenceMarkedBySelf: {
      const kisi = metin(data.personName, "Bir kişi");
      const aralik = metin(data.range, "");
      return {
        summary:
          `${kisi} ${aralik} için izin kaydı girdi. ` +
          "O günlerde hatırlatma gitmez ve ekip katılım oranında beklenen " +
          "kişi sayılmaz. Ayrıntıyı ekip ekranında görebilirsiniz.",
        path: "/team/absence",
      };
    }
    case NOTIFICATION_EVENTS.absenceRequestSubmitted: {
      const kisi = metin(data.personName, "Bir çalışan");
      const aralik = metin(data.range, "");
      return {
        summary: `${kisi} ${aralik} için izin talebi gönderdi; kararınız bekleniyor.`,
        path: "/team/absence",
      };
    }
    case NOTIFICATION_EVENTS.absenceRequestApproved: {
      const aralik = metin(data.range, "");
      const onaylayan = metin(data.approverName, "Yöneticiniz");
      return {
        summary: `${aralik} için izin talebiniz ${onaylayan} tarafından onaylandı.`,
        path: "/absence",
      };
    }
    case NOTIFICATION_EVENTS.absenceRequestRejected: {
      const aralik = metin(data.range, "");
      const reddeden = metin(data.approverName, "Yöneticiniz");
      return {
        summary:
          `${aralik} için izin talebiniz ${reddeden} tarafından reddedildi. Ayrıntıyı ve gerekçeyi İzinlerim bölümünde görebilirsiniz.`,
        path: "/absence",
      };
    }
    case NOTIFICATION_EVENTS.feedbackStatusChanged: {
      const baslik = metin(data.feedbackTitle, "Geri bildiriminiz");
      const durum = metin(data.feedbackStatus, "güncellendi");
      return {
        summary: `"${baslik}" başlıklı geri bildiriminizin durumu ${durum}. Ayrıntıyı Geri bildirim bölümünde görebilirsiniz.`,
        path: "/feedback",
      };
    }
    case NOTIFICATION_EVENTS.activityDeletionCode: {
      const code = typeof data.code === "string" ? data.code : "";
      const title = typeof data.title === "string" ? data.title : "";
      return {
        summary:
          `Faaliyet silme kodunuz: ${code}. On dakika geçerlidir ve bir kez ` +
          `kullanılır. Silinecek kayıt: "${title}". Bu isteği siz yapmadıysanız ` +
          "kodu kimseyle paylaşmayın; kod girilmedikçe hiçbir kayıt silinmez.",
        // Silme ekranına yönlendirme yok: bağlantıya tıklamak kodun yerini
        // tutmamalı, kod kasıtlı bir engeldir.
        path: "/admin/faaliyet-silme",
      };
    }
    case NOTIFICATION_EVENTS.passwordReset: {
      const token = typeof data.token === "string" ? data.token : "";
      return {
        summary:
          "Parola sıfırlama isteğiniz alındı. Bağlantı bir saat geçerlidir; " +
          "isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
        path: `/reset/${encodeURIComponent(token)}`,
      };
    }
  }
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * Bir kişiye giden e-posta. Kısa aralıkta biriken bildirimler **tek e-postada**
 * birleşir (§12.3): olay başına ayrı posta, kalabalık yüzünden okunmayan posta
 * demektir.
 */
export function renderEmail(
  lines: NotificationLine[],
  options: { baseUrl: string; digest: boolean },
): RenderedEmail {
  const subject =
    lines.length === 1 && !options.digest
      ? "Faaliyet Raporlama Sistemi — bildirim"
      : options.digest
        ? `Faaliyet Raporlama Sistemi — günlük özet (${lines.length} bildirim)`
        : `Faaliyet Raporlama Sistemi — ${lines.length} bildirim`;

  const govde = lines
    .map((line) => `- ${line.summary}\n  ${options.baseUrl}${line.path}`)
    .join("\n\n");

  const text = [
    options.digest
      ? "Bugün sizinle ilgili gelişmeler:"
      : "Sizinle ilgili yeni gelişme var:",
    "",
    govde,
    "",
    "Bu e-posta Faaliyet Raporlama Sistemi tarafından gönderildi.",
  ].join("\n");

  return { subject, text };
}
