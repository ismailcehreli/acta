// Bildirim olayları (§12.2). Olay adı hem kuyruğa hem şablona girer; metin
// olarak dağılmasın diye tek yerde toplanır.
//
// Onay, vekâlet ve diğer bildirim olayları burada tek listede tutulur. Yeni
// bir olay eklendiğinde görünen açıklaması da aşağıdaki ayrıntı tablosuna
// eklenir.

export const NOTIFICATION_EVENTS = {
  /** Faaliyete soru soruldu → konuşmanın sorumlusuna. */
  questionAsked: "question_asked",
  /** Soruya cevap geldi → soran kişiye. */
  answerReceived: "answer_received",
  /** Faaliyet iptal edildi → açık konuşmanın taraflarına. */
  activityCancelled: "activity_cancelled",
  /** Onay bekleyen faaliyet → aktif onaylayıcıya (§5.4). */
  approvalPending: "approval_pending",
  /** Faaliyet onaylandı → yazana. */
  activityApproved: "activity_approved",
  /** Düzeltme istendi → yazana, gerekçesiyle. */
  changesRequested: "changes_requested",
  activityRejected: "activity_rejected",
  /** Onay bekleyen kayıt eşiği aştı → onaylayıcıya (§5.4). */
  approvalOverdue: "approval_overdue",
  /** 3 iş günüdür cevap yok → sorumluya ve yöneticisine (Görev 5.4). */
  answerOverdue: "answer_overdue",
  /** Mesai sonu faaliyet yok → kişiye (Görev 5.4). */
  noActivityToday: "no_activity_today",
  /** Yönetici bulunamadı → sistem yöneticisine. */
  managerNotFound: "manager_not_found",
  /** Parola sıfırlama bağlantısı → kullanıcının kendisine (§15.3). */
  passwordReset: "password_reset",
  /**
   * Hesap açıldı → yeni kullanıcıya (21.08.2026, ürün sahibi isteği).
   *
   * **Parola bu e-postayla gönderilmez.** Kullanıcıya sistemin adresi ve
   * kendi e-posta adresi bildirilir; parolayı kendisi belirlesin diye
   * sıfırlama bağlantısı gönderilir. Parolayı e-postaya koymak, onu posta
   * kutusunda, yedeklerde ve arama sonuçlarında süresiz bırakırdı (§15.3).
   */
  accountCreated: "account_created",
  /** Eski sürümden kalan, kişinin kendi kaydı bildirimi. */
  absenceMarkedBySelf: "absence_marked_by_self",
  /** Çalışan kendi kaydı için yönetici kararı bekliyor. */
  absenceRequestSubmitted: "absence_request_submitted",
  /** Çalışanın talebi onaylandı. */
  absenceRequestApproved: "absence_request_approved",
  /** Çalışanın talebi reddedildi. */
  absenceRequestRejected: "absence_request_rejected",
  /** Geri bildirimin durumu veya yönetici yanıtı değişti. */
  feedbackStatusChanged: "feedback_status_changed",
  /** Zamanlanmış iş gecikti → sistem yöneticisine (§12.4). */
  jobDelayed: "job_delayed",
  /**
   * Faaliyet silme onay kodu → **yalnız kodu isteyen root'a** (karar
   * 03.09.2026). Kod on dakika geçerlidir ve tek kullanımlıktır.
   */
  activityDeletionCode: "activity_deletion_code",
} as const;

export type NotificationEvent =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export type NotificationDeliveryChannel = "EMAIL" | "PUSH" | "BOTH";

export interface NotificationEventDetails {
  label: string;
  description: string;
  defaultChannel: NotificationDeliveryChannel;
  canDisable: boolean;
}

/**
 * Bildirim ayarlarının görünen metni ve varsayılan kanalı burada tutulur.
 * Ayar ekranı ile kuyruğa yazma yolu aynı listeyi kullanır; yeni bir olay
 * eklendiğinde ayarı unutulmaz.
 */
export const NOTIFICATION_EVENT_DETAILS: Record<
  NotificationEvent,
  NotificationEventDetails
> = {
  [NOTIFICATION_EVENTS.questionAsked]: {
    label: "Faaliyete soru geldi",
    description: "Bir faaliyetiniz hakkında soru sorulduğunda haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.answerReceived]: {
    label: "Sorunuza cevap geldi",
    description: "Sorduğunuz soruya cevap verildiğinde haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityCancelled]: {
    label: "Faaliyet iptal edildi",
    description: "İlgili faaliyet iptal edildiğinde haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.approvalPending]: {
    label: "Onay bekleyen faaliyet",
    description: "Karar vermeniz gereken yeni bir faaliyet olduğunda haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityApproved]: {
    label: "Faaliyet onaylandı",
    description: "Faaliyetiniz onaylandığında haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.changesRequested]: {
    label: "Düzeltme istendi",
    description: "Faaliyetiniz için düzeltme istendiğinde haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityRejected]: {
    label: "Faaliyet uygun bulunmadı",
    description: "Faaliyetiniz uygun bulunmadığında haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.approvalOverdue]: {
    label: "Onay gecikti",
    description: "Bekleyen bir onay belirlenen süreyi aştığında haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.answerOverdue]: {
    label: "Cevap gecikti",
    description: "Cevap bekleyen bir soru belirlenen süreyi aştığında haber verir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.noActivityToday]: {
    label: "Bugün faaliyet girilmedi",
    description: "Bugün için faaliyet girilmediğinde hatırlatma gönderir.",
    defaultChannel: "BOTH",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.managerNotFound]: {
    label: "Yönetici bulunamadı",
    description: "Bir faaliyet için yönetici bulunamadığında haber verir.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.passwordReset]: {
    label: "Parola sıfırlama",
    description: "Parola belirleme veya sıfırlama bağlantısını gönderir.",
    defaultChannel: "EMAIL",
    canDisable: false,
  },
  [NOTIFICATION_EVENTS.accountCreated]: {
    label: "Yeni hesap bilgisi",
    description: "Yeni hesap açıldığında parola belirleme bağlantısını gönderir.",
    defaultChannel: "EMAIL",
    canDisable: false,
  },
  [NOTIFICATION_EVENTS.absenceMarkedBySelf]: {
    label: "İzin kaydı oluşturuldu",
    description: "Eski kayıtlardan gelen bu bildirimi açıp kapatabilirsiniz.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.absenceRequestSubmitted]: {
    label: "İzin talebi geldi",
    description: "Bir çalışan izin talebi gönderdiğinde yöneticiyi bilgilendirir.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.absenceRequestApproved]: {
    label: "İzin talebi onaylandı",
    description: "Gönderdiğiniz izin talebi onaylandığında haber verir.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.absenceRequestRejected]: {
    label: "İzin talebi reddedildi",
    description: "Talebiniz reddedildiğinde yöneticinin açıklamasıyla birlikte haber verir.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.feedbackStatusChanged]: {
    label: "Geri bildiriminiz güncellendi",
    description: "Geri bildiriminizin durumu veya yönetici yanıtı değiştiğinde haber verir.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
  [NOTIFICATION_EVENTS.activityDeletionCode]: {
    label: "Faaliyet silme kodu",
    description:
      "Ana sistem yöneticisi bir faaliyeti silmek istediğinde onay kodunu gönderir.",
    defaultChannel: "EMAIL",
    // Kapatılamaz: kod gitmezse silme de yapılamaz, yani kapatmak sessizce
    // özelliği devre dışı bırakırdı.
    canDisable: false,
  },
  [NOTIFICATION_EVENTS.jobDelayed]: {
    label: "Zamanlanmış iş gecikti",
    description: "Arka plandaki bir iş beklenen sürede çalışmadığında haber verir.",
    defaultChannel: "EMAIL",
    canDisable: true,
  },
};

export function isKnownEvent(value: string): value is NotificationEvent {
  return Object.values(NOTIFICATION_EVENTS).includes(value as NotificationEvent);
}

/**
 * Bekleyemeyen olaylar. Bunlar günlük özet moduna girmez ve başka
 * bildirimlerle **birleştirilmez**: parola sıfırlama bağlantısının akşam 18:00
 * özetini beklemesi, bağlantının bir saatlik ömrü içinde işe yaramaz hâle
 * gelmesi demekti.
 */
export const URGENT_EVENTS: readonly string[] = [
  NOTIFICATION_EVENTS.passwordReset,
  // Yeni hesap e-postası da parola belirleme bağlantısı taşır; günlük özeti
  // beklerse bağlantı süresi dolabilir.
  NOTIFICATION_EVENTS.accountCreated,
  // Zamanlayıcı durduğunda haberin akşam özetini beklemesi, arızanın bir gün
  // daha sürmesi demekti (§12.4).
  NOTIFICATION_EVENTS.jobDelayed,
  // On dakikalık silme kodunun akşam 18:00 özetini beklemesi, kodun ömrü
  // içinde işe yaramaz hâle gelmesi demekti.
  NOTIFICATION_EVENTS.activityDeletionCode,
];

export function isUrgentEvent(eventType: string): boolean {
  return URGENT_EVENTS.includes(eventType);
}

/**
 * Telefonu titretmeye değer olaylar (Görev 5.3b).
 *
 * "Acil" listesiyle **aynı şey değildir.** Acil olanlar günlük özete
 * girmeyenlerdir — parola sıfırlama gibi. Push ise kişiyi işine çağıran
 * olaylar içindir: sorulan soru, önüne düşen onay, istenen düzeltme.
 *
 * Dışarıda bıraktıklarımız bilinçli:
 * - `passwordReset`: bağlantı postadadır, kilit ekranında işi yoktur.
 * - `managerNotFound` ve `jobDelayed`: sistem yöneticisinin işletim uyarıları;
 *   ekranda ve postada duruyor, gece telefon titretmesi gerekmiyor.
 */
export const PUSH_EVENTS: readonly string[] = [
  NOTIFICATION_EVENTS.questionAsked,
  NOTIFICATION_EVENTS.answerReceived,
  NOTIFICATION_EVENTS.activityCancelled,
  NOTIFICATION_EVENTS.approvalPending,
  NOTIFICATION_EVENTS.activityApproved,
  NOTIFICATION_EVENTS.changesRequested,
  NOTIFICATION_EVENTS.activityRejected,
  NOTIFICATION_EVENTS.approvalOverdue,
  NOTIFICATION_EVENTS.answerOverdue,
  NOTIFICATION_EVENTS.noActivityToday,
  NOTIFICATION_EVENTS.absenceRequestSubmitted,
];

export function isPushEvent(eventType: string): boolean {
  return PUSH_EVENTS.includes(eventType);
}

/**
 * Kişiden **bir şey isteyen** olaylar (Görev 10.8).
 *
 * "Yalnız benden işlem isteyenler" tercihi bunları geçirir, gerisini eler.
 * Ayrımın ölçütü şu: bu bildirimi okuduktan sonra yapacağım bir şey var mı?
 *
 * Dışarıda kalanlar bilgilendirmedir: kayıt onaylandı, soruma cevap geldi,
 * faaliyet iptal edildi. Bunları da isteyen "anlık" tercihini seçer.
 *
 * **Acil olaylar bu süzgeçten muaftır** (parola sıfırlama, iş gecikmesi):
 * tercih ne olursa olsun gider. Parola sıfırlama bağlantısının bir tercih
 * yüzünden hiç gitmemesi, kullanıcıyı sistemden kilitlerdi.
 */
export const ACTION_REQUIRED_EVENTS: readonly string[] = [
  NOTIFICATION_EVENTS.questionAsked,
  NOTIFICATION_EVENTS.approvalPending,
  NOTIFICATION_EVENTS.changesRequested,
  NOTIFICATION_EVENTS.approvalOverdue,
  NOTIFICATION_EVENTS.answerOverdue,
  NOTIFICATION_EVENTS.noActivityToday,
  NOTIFICATION_EVENTS.managerNotFound,
  NOTIFICATION_EVENTS.absenceRequestSubmitted,
];

export function isActionRequiredEvent(eventType: string): boolean {
  return ACTION_REQUIRED_EVENTS.includes(eventType);
}
