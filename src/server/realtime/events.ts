import { z } from "zod";

// Gerçek zamanlı olaylar (§13, Görev 7.3).
//
// **Bu olaylar içerik taşımaz.** Tarayıcıya giden tek bilgi "ilgilendiğin bir
// şey değişti"dir; başlık, mesaj metni, kimlik hiçbiri gitmez. Sebep basit:
// SSE akışı görünürlük modülünden geçmez, geçemez de — akış açıkken kullanıcının
// yetkisi değişebilir. İçeriği taşımayan bir haber sızdıramaz. İstemci haberi
// alınca sayfayı tazeler ve içerik **her zamanki görünürlük denetiminden**
// geçerek gelir (§18.4).
//
// Bildirim olaylarından (`src/server/notifications/events.ts`) ayrı tutulur:
// onlar e-postaya dönüşür ve metin taşır, bunlar yalnızca bir tazeleme
// işaretidir. İkisini tek listeye toplamak, birinin kuralını diğerine
// bulaştırma riski demekti.

export const REALTIME_EVENTS = {
  /**
   * Yeni faaliyet yazıldı → yazarın üst zincirine.
   *
   * Kapsam akışı ve ana ekrandaki sayaçlar bunun olmadığı sürece canlı
   * değildi: meslektaşın yazdığı kayıt ancak sayfa elle yenilenince
   * görünüyordu. Haber yine içerik taşımaz; alıcı listesi üst zincirdir ve
   * içerik tazelemede görünürlük modülünden geçerek gelir.
   */
  activityCreated: "activity_created",
  /** Faaliyete soru soruldu → sorumluya ve sorana. */
  questionAsked: "question_asked",
  /** Konuşmaya cevap yazıldı → karşı tarafa. */
  answerReceived: "answer_received",
  /** Konuşma kapandı → taraflara. */
  conversationClosed: "conversation_closed",
  /** Faaliyet iptal edildi → açık konuşmalarının taraflarına. */
  activityCancelled: "activity_cancelled",
  /** Onay bekleyen yeni kayıt → onaylayıcıya. */
  approvalPending: "approval_pending",
  /** Onaylandı ya da düzeltme istendi → yazana ve onaylayıcıya. */
  approvalDecided: "approval_decided",
  /**
   * Dinleyici bağlantısı koptu ve yeniden kuruldu. Kopukluk boyunca gelen
   * olaylar kaybolmuştur; istemci bu işareti alınca koşulsuz tazeler.
   * Sessizce eksik kalmaktansa bir kez fazladan tazelemek yeğdir.
   */
  reconnected: "reconnected",
} as const;

export type RealtimeEventKind =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/**
 * `pg_notify` yükünün şeması. Veritabanından gelen metin doğrulanmadan
 * kullanılmaz: kanal başka bir süreç tarafından da beslenebilir ve bozuk bir
 * yük fan-out döngüsünü düşürmemeli.
 */
export const realtimeNotifySchema = z.object({
  kind: z.enum([
    REALTIME_EVENTS.activityCreated,
    REALTIME_EVENTS.questionAsked,
    REALTIME_EVENTS.answerReceived,
    REALTIME_EVENTS.conversationClosed,
    REALTIME_EVENTS.activityCancelled,
    REALTIME_EVENTS.approvalPending,
    REALTIME_EVENTS.approvalDecided,
  ]),
  /** Haberin gideceği kullanıcılar. Veritabanı bağlantısından dışarı çıkmaz. */
  userIds: z.array(z.string().uuid()).min(1),
});

export type RealtimeNotify = z.infer<typeof realtimeNotifySchema>;

/**
 * Veritabanı üzerinden yayımlanabilen türler. `reconnected` bilerek dışarıda:
 * onu hub kendi üretir, kimse yayımlamaz.
 */
export type PublishableEventKind = RealtimeNotify["kind"];

/** Tarayıcıya giden gövde. Türden başka bir şey yok — bilerek. */
export interface RealtimeEvent {
  kind: RealtimeEventKind;
}

/** PostgreSQL bildirim kanalı. Tek kanal; ayrım yük içinde yapılır. */
export const REALTIME_CHANNEL = "faaliyet_olay";
