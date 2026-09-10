import { formatDomainList, parseDomainList } from "./email-domains";
import {
  NOTIFICATION_EVENT_DETAILS,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "../notifications/events";

// Ayar kayıt defteri (§16.5). Her ayarın anahtarı, türü, varsayılanı, sınırları
// ve Türkçe açıklaması burada tek yerde durur.
//
// Amaç işletimseldir: "üç iş günü cevapsızsa hatırlat" bugün üç, yarın bir
// olabilir. Bunu değiştirmek için kod okumak, dosya bulmak ve sürüm çıkarmak
// gerekmemeli. Defterdeki her ayar `/admin/settings` ekranında görünür.
//
// Buraya **her** sabit konmaz. Argon2 parametreleri gibi değiştirildiğinde
// mevcut verinin anlamını bozan değerler kodda kalır; sınırı bu.

export type SettingType =
  | "number"
  | "boolean"
  | "time"
  | "domains"
  | "select";

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDefinition {
  key: string;
  /** Ekrandaki grup başlığı. */
  group: string;
  label: string;
  description: string;
  type: SettingType;
  /** Kayıt yoksa kullanılan değer; metin olarak saklanır. */
  defaultValue: string;
  /** Sayısal ayarlar için sınırlar. */
  min?: number;
  max?: number;
  /** Ekranda değerin yanında gösterilen birim. */
  unit?: string;
  /** Metin alanları için ipucu. */
  placeholder?: string;
  /** Seçim alanlarında gösterilen seçenekler. */
  options?: readonly SettingOption[];
}

export const SETTING_KEYS = {
  /** Kaç gün geriye faaliyet girilebilir (§5.6). */
  retroactiveEntryDays: "retroactive_entry_days",
  /** Kayıttan sonra kaç dakika düzeltilebilir (§5.5). */
  editWindowMinutes: "edit_window_minutes",
  /** Detay ekranında kaç saniye kalınca "okundu" sayılır (§10.2). */
  readDwellSeconds: "read_dwell_seconds",
  /** Soranın üstü kaç iş günü sonra kapatabilir (§9.3). */
  supervisorTakeoverBusinessDays: "supervisor_takeover_business_days",
  /** Kaç iş günü cevapsız kalınca hatırlatma gider (§12.2). */
  overdueAnswerBusinessDays: "overdue_answer_business_days",
  /** Kaç iş günü onaylanmayan kayıt için onaylayıcıya hatırlatma gider (§5.4). */
  pendingApprovalBusinessDays: "pending_approval_business_days",
  /** Günlük özet e-postasının saati, şirket saatiyle (§12.3). */
  dailyDigestHour: "daily_digest_hour",
  /** Ek dosya sınırları (§15.4). */
  attachmentMaxMb: "attachment_max_mb",
  attachmentMaxCount: "attachment_max_count",
  /** Yöneticiye katılım özeti; varsayılan kapalı (§12.1). */
  managerParticipationSummary: "manager_participation_summary",
  /** Oturum ömrü (§15.3). */
  sessionHours: "session_hours",
  /** "Beni hatırla" işaretlendiğinde oturum kaç gün sürer; 0 = özellik kapalı. */
  rememberMeDays: "remember_me_days",
  /** Kilit süresi (§15.3). */
  lockoutMinutes: "lockout_minutes",
  /** Hesap açılabilecek e-posta alan adları; boş liste kısıt yok demektir. */
  allowedEmailDomains: "allowed_email_domains",
  /** Takip maddesi kaç iş günü hareketsiz kalınca "uzun süredir açık" sayılır (§11.2). */
  followUpStaleBusinessDays: "follow_up_stale_business_days",
  /** Faaliyet metinlerinin uzunluk sınırları (Görev 11.6). */
  activityTitleMinChars: "activity_title_min_chars",
  activityTitleMaxChars: "activity_title_max_chars",
  activityDescriptionMinChars: "activity_description_min_chars",
  activityDescriptionMaxChars: "activity_description_max_chars",
  /** Kişinin kendi girebileceği en uzun "faaliyet beklenmiyor" dönemi (Görev 11.8). */
  selfAbsenceMaxDays: "self_absence_max_days",
  /** Skor sistemi (Görev 11.10, 11.11). Varsayılan **kapalı**. */
  scoringEnabled: "scoring_enabled",
  scoringDeclinePeriods: "scoring_decline_periods",
  /** Temel skorun dört ağırlığı; üç profilde de toplamı 100 olmak zorunda. */
  scoringWeightRegularity: "scoring_weight_regularity",
  scoringWeightAcceptance: "scoring_weight_acceptance",
  scoringWeightApproval: "scoring_weight_approval",
  scoringWeightFollowUp: "scoring_weight_follow_up",
  scoringAppreciationPoints: "scoring_appreciation_points",
  scoringRankingEnabled: "scoring_ranking_enabled",
  appreciationEnabled: "appreciation_enabled",
  /** Zamanlanmış iş gecikme alarmları. */
  jobDelayAlertEnabled: "job_delay_alert_enabled",
  jobDelayAlertRepeatHours: "job_delay_alert_repeat_hours",
  /** İlk başarılı yedekten sonra koşucu tarafından açılır. */
  backupMonitoringEnabled: "backup_monitoring_enabled",
  /** Mesai bitiminden kaç dakika önce faaliyet hatırlatması gönderilir (§12.1). */
  noActivityReminderLeadMinutes: "no_activity_reminder_lead_minutes",
} as const;

/**
 * Veritabanı kolon genişlikleri — **ayarların aşamayacağı tavan**.
 *
 * `VarChar(150)` ve `VarChar(10000)` yerinde kalıyor; ayar bu tavanın
 * **içinde** hareket ediyor. Kolon genişliğini ayardan değiştirmek, her ayar
 * değişikliğini bir veritabanı geçişine dönüştürürdü.
 */
export const ACTIVITY_TITLE_COLUMN_MAX = 150;
export const ACTIVITY_DESCRIPTION_COLUMN_MAX = 10_000;

/**
 * Birbirine bağlı ayar çiftleri (Görev 11.6).
 *
 * Her ayar tek başına doğrulanıyordu: türü, alt ve üst sınırı. Metin uzunluk
 * sınırları **ilk bağımlı çift**: "en az" değeri "en çok"tan büyük olursa
 * hiçbir metin kabul edilmez ve kullanıcı formu hiç dolduramaz — her iki
 * değer de kendi sınırları içinde olduğu hâlde.
 *
 * Aynı mekanizma skor ağırlıklarının toplamını zorlamak için de kullanılacak
 * (Görev 11.10).
 */
export interface SettingPairRule {
  /** Küçük olması gereken ayar. */
  min: string;
  /** Büyük ya da eşit olması gereken ayar. */
  max: string;
  /** Kural bozulduğunda gösterilecek mesaj. */
  message: string;
}

export const SETTING_PAIR_RULES: SettingPairRule[] = [
  {
    min: SETTING_KEYS.activityTitleMinChars,
    max: SETTING_KEYS.activityTitleMaxChars,
    message:
      "Başlık için \u201cen az\u201d değeri \u201cen çok\u201dtan büyük olamaz.",
  },
  {
    min: SETTING_KEYS.activityDescriptionMinChars,
    max: SETTING_KEYS.activityDescriptionMaxChars,
    message:
      "Açıklama için \u201cen az\u201d değeri \u201cen çok\u201dtan büyük olamaz.",
  },
];

/**
 * Toplamı sabit olmak zorunda olan ayar kümeleri (Görev 11.10,
 * denetim 23.08.2026 bulgu 8).
 *
 * Temel skorun tavanı **her profilde 100**; kişiden kişiye değişen bir tavan
 * kıyaslanabilirliği bitirirdi. Takdir katkısı bu temel toplamın dışındadır.
 * Üç profil üç ayrı denklemdir ve üçü birden
 * doğrulanır: tek tek geçerli dört sayı, bir profilde 110 edebilir.
 *
 * Onaya tabi olmayan profilin düzenlilik ağırlığı ayrı bir ayar değil,
 * "düzenlilik + kabul oranı" toplamıdır (tasarım satır 686) — bu yüzden onun
 * denklemi çalışan profiliyle aynı sayılara dayanır.
 */
export interface SettingSumRule {
  keys: string[];
  total: number;
  message: string;
}

export const SETTING_SUM_RULES: SettingSumRule[] = [
  {
    keys: [
      SETTING_KEYS.scoringWeightRegularity,
      SETTING_KEYS.scoringWeightAcceptance,
      SETTING_KEYS.scoringWeightFollowUp,
    ],
    total: 100,
    message:
      "Onaya tabi çalışan profilinde ağırlıklar toplamı 100 olmalı: düzenli raporlama + kabul oranı + takip disiplini.",
  },
  {
    keys: [
      SETTING_KEYS.scoringWeightRegularity,
      SETTING_KEYS.scoringWeightApproval,
      SETTING_KEYS.scoringWeightFollowUp,
    ],
    total: 100,
    message:
      "Yönetici profilinde ağırlıklar toplamı 100 olmalı: düzenli raporlama + onay süresi + takip disiplini.",
  },
];

const STATIC_SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: SETTING_KEYS.scoringEnabled,
    group: "Skor",
    label: "Skor sistemi açık",
    description:
      "Kapalıyken skorlar hiçbir ekranda görünmez. Açıldığında kullanıcılar kendi skorlarını, yöneticiler ekip skorlarını görür.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.scoringDeclinePeriods,
    group: "Skor",
    label: "Düşüş işareti eşiği",
    description:
      "Kaç dönem üst üste düşüşte kişinin yanında uyarı gösterileceğini belirler. Daha küçük değer erken, daha büyük değer daha uzun eğilim bekler.",
    type: "number",
    defaultValue: "3",
    min: 2,
    max: 12,
    unit: "dönem",
  },
  {
    key: SETTING_KEYS.scoringWeightRegularity,
    group: "Skor",
    label: "Düzenli raporlama ağırlığı",
    description:
      "Düzenli raporlama bölümünün puandaki payını belirler. Onaya tabi olmayan çalışanlarda kabul oranının payı da bu bölüme eklenir.",
    type: "number",
    defaultValue: "60",
    min: 0,
    max: 100,
    unit: "puan",
  },
  {
    key: SETTING_KEYS.scoringWeightAcceptance,
    group: "Skor",
    label: "Kabul oranı ağırlığı",
    description:
      "Onaylanan kayıtların payının puandaki ağırlığını belirler. Yalnız onaya tabi çalışanlarda kullanılır.",
    type: "number",
    defaultValue: "30",
    min: 0,
    max: 100,
    unit: "puan",
  },
  {
    key: SETTING_KEYS.scoringWeightApproval,
    group: "Skor",
    label: "Onay süresi ağırlığı",
    description:
      "Yöneticinin kayıtları zamanında karara bağlamasının puandaki ağırlığını belirler. Ret de karar sayılır.",
    type: "number",
    defaultValue: "30",
    min: 0,
    max: 100,
    unit: "puan",
  },
  {
    key: SETTING_KEYS.scoringWeightFollowUp,
    group: "Skor",
    label: "Takip disiplini ağırlığı",
    description:
      "Sorulara cevap verme ve takip maddelerini tamamlama bölümünün puandaki payını belirler. Üç profilde de aynıdır.",
    type: "number",
    defaultValue: "10",
    min: 0,
    max: 100,
    unit: "puan",
  },
  {
    key: SETTING_KEYS.scoringAppreciationPoints,
    group: "Skor",
    label: "Takdir başına puan",
    description:
      "Onaylanmış faaliyetlere verilen her geçerli takdirin genel puana ekleyeceği puanı belirler. 0 yazılırsa takdir verilebilir ama puana katkı yapmaz.",
    type: "number",
    defaultValue: "1",
    min: 0,
    max: 10,
    unit: "puan",
  },
  {
    key: SETTING_KEYS.scoringRankingEnabled,
    group: "Skor",
    label: "Sıralama sekmesi açık",
    description:
      "Açıksa ekip skorları ekranında skora göre sıralama seçilebilir. Kapalıyken liste alfabetik gösterilir; genel şirket sıralaması yine gösterilmez.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.appreciationEnabled,
    group: "Skor",
    label: "Takdir sistemi açık",
    description:
      "Açıksa yetkili kullanıcılar faaliyetlere takdir verebilir. Takdir sayısı, ayarlanan puan kadar genel skora katkı yapar ve faaliyetin yanında ayrıca gösterilir.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.selfAbsenceMaxDays,
    group: "İzin ve faaliyet dışı günler",
    label: "Kişinin girebileceği en uzun dönem",
    description:
      "Kişinin kendisi için tek seferde girebileceği en uzun izin veya faaliyet dışı gün dönemini belirler. Daha uzun dönemi yönetici girebilir.",
    type: "number",
    defaultValue: "30",
    min: 1,
    max: 365,
    unit: "gün",
  },
  {
    key: SETTING_KEYS.activityTitleMinChars,
    group: "Faaliyet girişi",
    label: "Başlık en az",
    description:
      "Başlığın kabul edilmesi için gereken en az karakter sayısıdır. Varsayılan 1, boş başlıkları engeller ve kısa başlıklara izin verir.",
    type: "number",
    defaultValue: "1",
    min: 1,
    max: 100,
    unit: "karakter",
  },
  {
    key: SETTING_KEYS.activityTitleMaxChars,
    group: "Faaliyet girişi",
    label: "Başlık en çok",
    description:
      "Başlık için izin verilen en fazla karakter sayısıdır. Üst sınır veritabanındaki 150 karakterlik alanı aşamaz.",
    type: "number",
    defaultValue: "150",
    min: 10,
    max: ACTIVITY_TITLE_COLUMN_MAX,
    unit: "karakter",
  },
  {
    key: SETTING_KEYS.activityDescriptionMinChars,
    group: "Faaliyet girişi",
    label: "Açıklama en az",
    description:
      "Açıklamanın kabul edilmesi için gereken en az karakter sayısıdır. Varsayılan 1, açıklamanın boş bırakılmasını engeller.",
    type: "number",
    defaultValue: "1",
    min: 1,
    max: 1000,
    unit: "karakter",
  },
  {
    key: SETTING_KEYS.activityDescriptionMaxChars,
    group: "Faaliyet girişi",
    label: "Açıklama en çok",
    description:
      "Açıklama için izin verilen en fazla karakter sayısıdır. Üst sınır veritabanındaki 10.000 karakterlik alanı aşamaz.",
    type: "number",
    defaultValue: "10000",
    min: 100,
    max: ACTIVITY_DESCRIPTION_COLUMN_MAX,
    unit: "karakter",
  },
  {
    key: SETTING_KEYS.retroactiveEntryDays,
    group: "Faaliyet girişi",
    label: "Geçmişe dönük giriş",
    description:
      "Kullanıcının bugünden geriye doğru kaç gün için faaliyet girebileceğini belirler. Daha eski tarihler için giriş yapılamaz.",
    type: "number",
    defaultValue: "1",
    min: 0,
    max: 90,
    unit: "gün",
  },
  {
    key: SETTING_KEYS.editWindowMinutes,
    group: "Faaliyet girişi",
    label: "Düzeltme penceresi",
    description:
      "Kayıt oluşturulduktan sonra kaç dakika düzeltilebileceğini belirler. Kayıt okunduğunda süre dolmamış olsa bile düzenleme kapanır.",
    type: "number",
    defaultValue: "15",
    min: 0,
    max: 1440,
    unit: "dakika",
  },
  {
    key: SETTING_KEYS.readDwellSeconds,
    group: "Faaliyet girişi",
    label: "Okundu sayma süresi",
    description:
      "Detay ekranı en az kaç saniye açık kalırsa kaydın okundu sayılacağını belirler. Listeyi hızlıca geçmek okundu sayılmaz.",
    type: "number",
    defaultValue: "2",
    min: 1,
    max: 60,
    unit: "saniye",
  },
  {
    key: SETTING_KEYS.pendingApprovalBusinessDays,
    group: "Onay akışı",
    label: "Onay hatırlatması",
    description:
      "Onay bekleyen kaydın kaç iş günü sonra hatırlatılacağını belirler. Hafta sonu ve resmî tatiller sayılmaz; bu süre skor hesabındaki onay süresini de etkiler.",
    type: "number",
    defaultValue: "2",
    min: 1,
    max: 30,
    unit: "iş günü",
  },
  {
    key: SETTING_KEYS.followUpStaleBusinessDays,
    group: "Takip maddeleri",
    label: "Hareketsizlik eşiği",
    description:
      "Takip maddesinin kaç iş günü hareketsiz kaldığında uyarılacağını belirler. Aynı süre, takip disiplini skorunda maddenin ele alınıp alınmadığını da belirler.",
    type: "number",
    defaultValue: "5",
    min: 1,
    max: 60,
    unit: "iş günü",
  },
  {
    key: SETTING_KEYS.supervisorTakeoverBusinessDays,
    group: "Soru–cevap",
    label: "Üstün devreye girmesi",
    description:
      "Soru sahibi kaç iş günü işlem yapmazsa yöneticisinin konuşmayı kapatabileceğini belirler. Bu süre yalnız konuşmayı kapatma yetkisini etkiler.",
    type: "number",
    defaultValue: "10",
    min: 1,
    max: 60,
    unit: "iş günü",
  },
  {
    key: SETTING_KEYS.overdueAnswerBusinessDays,
    group: "Soru–cevap",
    label: "Cevapsızlık hatırlatması",
    description:
      "Cevaplanmayan sorunun kaç iş günü sonra hatırlatılacağını belirler. Aynı süre, takip disiplini skorunda cevabın zamanında sayılıp sayılmadığını da etkiler.",
    type: "number",
    defaultValue: "3",
    min: 1,
    max: 30,
    unit: "iş günü",
  },
  {
    key: SETTING_KEYS.dailyDigestHour,
    group: "Bildirimler",
    label: "Günlük özet saati",
    description:
      "Günlük özet seçen kullanıcılara e-postanın gönderileceği saattir. Saat şirketin yerel saatine göre uygulanır.",
    type: "time",
    defaultValue: "18",
    min: 0,
    max: 23,
    unit: ":00",
  },
  {
    key: SETTING_KEYS.noActivityReminderLeadMinutes,
    group: "Bildirimler",
    label: "Mesai öncesi faaliyet hatırlatma süresi",
    description:
      "Mesai bitiminden kaç dakika önce “bugün faaliyet girmediniz” hatırlatması gönderileceğini belirler. 0 girilirse hatırlatma mesai bitiminde gönderilir.",
    type: "number",
    defaultValue: "60",
    min: 0,
    max: 180,
    unit: "dakika",
  },
  {
    key: SETTING_KEYS.managerParticipationSummary,
    group: "Bildirimler",
    label: "Yöneticiye katılım özeti",
    description:
      "Açılırsa yöneticilere, ekipte o gün kaç kişinin faaliyet yazdığını gösteren özet gönderilir. Kapalıyken bu özet gönderilmez.",
    type: "boolean",
    defaultValue: "false",
  },
  {
    key: SETTING_KEYS.attachmentMaxMb,
    group: "Dosya ekleri",
    label: "Azami dosya boyutu",
    description:
      "Tek bir ek dosyanın en fazla kaç MB olabileceğini belirler. Daha büyük dosyalar yüklenemez.",
    type: "number",
    defaultValue: "25",
    min: 1,
    max: 200,
    unit: "MB",
  },
  {
    key: SETTING_KEYS.attachmentMaxCount,
    group: "Dosya ekleri",
    label: "Azami ek sayısı",
    description:
      "Bir faaliyete en fazla kaç dosya eklenebileceğini belirler. Sayı aşıldığında yeni dosya eklenemez.",
    type: "number",
    defaultValue: "5",
    min: 1,
    max: 20,
    unit: "adet",
  },
  {
    key: SETTING_KEYS.allowedEmailDomains,
    group: "Kullanıcı hesapları",
    label: "İzinli e-posta alan adları",
    description:
      "Yeni hesaplarda ve adres değişikliklerinde kabul edilecek alan adlarını virgülle yazın. Boş bırakılırsa kısıt uygulanmaz; mevcut hesaplar etkilenmez.",
    type: "domains",
    defaultValue: "",
    placeholder: "example.com, example.org",
  },
  {
    key: SETTING_KEYS.rememberMeDays,
    group: "Oturum ve güvenlik",
    label: "“Beni hatırla” süresi",
    description:
      "Girişte “Beni hatırla” seçildiğinde oturumun kaç gün açık kalacağını belirler. 0 yazılırsa bu seçenek giriş ekranında gösterilmez.",
    type: "number",
    defaultValue: "30",
    min: 0,
    max: 90,
    unit: "gün",
  },
  {
    key: SETTING_KEYS.sessionHours,
    group: "Oturum ve güvenlik",
    label: "Oturum ömrü",
    description:
      "Giriş yapılan oturumun kaç saat sonra sona ereceğini belirler. Süre dolunca kullanıcıdan yeniden parola istenir.",
    type: "number",
    defaultValue: "12",
    min: 1,
    max: 168,
    unit: "saat",
  },
  {
    key: SETTING_KEYS.lockoutMinutes,
    group: "Oturum ve güvenlik",
    label: "Hesap kilidi süresi",
    description:
      "Arka arkaya on yanlış parola denemesinden sonra hesabın kaç dakika kilitleneceğini belirler. Parola sıfırlama bağlantısı kilidi beklemeden kaldırır.",
    type: "number",
    defaultValue: "15",
    min: 1,
    max: 1440,
    unit: "dakika",
  },
  {
    key: SETTING_KEYS.jobDelayAlertEnabled,
    group: "Bildirimler",
    label: "Gecikme uyarıları",
    description:
      "Zamanlanmış işler beklenen sürede çalışmadığında sistem yöneticilerine uyarı gönderilip gönderilmeyeceğini belirler.",
    type: "boolean",
    defaultValue: "true",
  },
  {
    key: SETTING_KEYS.jobDelayAlertRepeatHours,
    group: "Bildirimler",
    label: "Gecikme uyarısı tekrarı",
    description:
      "Aynı iş gecikmeye devam ederse uyarının kaç saatte bir yeniden gönderileceğini belirler. En az 1 saat seçilebilir.",
    type: "number",
    defaultValue: "24",
    min: 1,
    max: 168,
    unit: "saat",
  },
  {
    key: SETTING_KEYS.backupMonitoringEnabled,
    group: "Bildirimler",
    label: "Yedekleme izlemesi",
    description:
      "Yedek işi geciktiğinde uyarı gönderilmesini açar. İlk başarılı yedekten sonra sistem bunu kendiliğinden açar.",
    type: "boolean",
    defaultValue: "false",
  },
];

export const NOTIFICATION_SETTING_PREFIX = "notification_";

export function notificationEnabledKey(event: NotificationEvent): string {
  return `${NOTIFICATION_SETTING_PREFIX}${event}_enabled`;
}

export function notificationChannelKey(event: NotificationEvent): string {
  return `${NOTIFICATION_SETTING_PREFIX}${event}_channel`;
}

export const NOTIFICATION_CHANNEL_OPTIONS: readonly SettingOption[] = [
  { value: "EMAIL", label: "E-posta" },
  { value: "PUSH", label: "Tarayıcı bildirimi" },
  { value: "BOTH", label: "E-posta ve tarayıcı bildirimi" },
];

const REQUIRED_NOTIFICATION_CHANNEL_OPTIONS: readonly SettingOption[] =
  NOTIFICATION_CHANNEL_OPTIONS.filter((option) => option.value !== "PUSH");

function notificationSettingDefinitions(): SettingDefinition[] {
  return (Object.values(NOTIFICATION_EVENTS) as NotificationEvent[]).flatMap(
    (event) => {
      const details = NOTIFICATION_EVENT_DETAILS[event];
      const definitions: SettingDefinition[] = [];

      if (details.canDisable) {
        definitions.push({
          key: notificationEnabledKey(event),
          group: "Bildirimler",
          label: details.label,
          description: details.description,
          type: "boolean",
          defaultValue: "true",
        });
      }

      definitions.push({
        key: notificationChannelKey(event),
        group: "Bildirimler",
        label: `${details.label} kanalı`,
        description: details.canDisable
          ? "Bu bildirimin hangi kanaldan gönderileceğini seçin."
          : `${details.description} Bu bildirim kapatılamaz.`,
        type: "select",
        defaultValue: details.defaultChannel,
        // Parola bağlantısı taşıyan olaylar e-postasız bırakılamaz. "Push"
        // seçeneği yeni hesapta ya da aboneliği olmayan kişide bağlantıyı
        // ulaştırmaz; e-posta veya iki kanal zorunlu tutulur.
        options: details.canDisable
          ? NOTIFICATION_CHANNEL_OPTIONS
          : REQUIRED_NOTIFICATION_CHANNEL_OPTIONS,
      });

      return definitions;
    },
  );
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  ...STATIC_SETTING_DEFINITIONS,
  ...notificationSettingDefinitions(),
];

export const SETTING_GROUPS = [
  "Faaliyet girişi",
  // Onay akışı Sürüm 1'e alındı (19.08.2026); ayarları kendi başlığı altında.
  "Onay akışı",
  "Soru–cevap",
  "Takip maddeleri",
  // İzin girişi kişiye açıldı (Görev 11.8); sınırı burada duruyor.
  "İzin ve faaliyet dışı günler",
  "Bildirimler",
  "Dosya ekleri",
  "Kullanıcı hesapları",
  "Skor",
  "Oturum ve güvenlik",
] as const;

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function findSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export type SettingValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** Girdiyi ayarın türüne ve sınırlarına göre doğrular. */
export function validateSettingValue(
  definition: SettingDefinition,
  raw: string,
): SettingValidation {
  const trimmed = raw.trim();

  if (definition.type === "domains") {
    const liste = parseDomainList(trimmed);
    if (!liste.ok) return { ok: false, message: `${definition.label}: ${liste.message}` };
    return { ok: true, value: formatDomainList(liste.domains) };
  }

  if (definition.type === "boolean") {
    if (trimmed !== "true" && trimmed !== "false") {
      return { ok: false, message: `${definition.label}: değer açık ya da kapalı olmalı.` };
    }
    return { ok: true, value: trimmed };
  }

  if (definition.type === "select") {
    const options = definition.options ?? [];
    if (!options.some((option) => option.value === trimmed)) {
      return { ok: false, message: `${definition.label}: geçerli bir seçenek seçin.` };
    }
    return { ok: true, value: trimmed };
  }

  const sayi = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(sayi) || !Number.isInteger(sayi)) {
    return { ok: false, message: `${definition.label}: tam sayı girilmeli.` };
  }

  if (definition.min !== undefined && sayi < definition.min) {
    return {
      ok: false,
      message: `${definition.label}: en az ${definition.min} olabilir.`,
    };
  }

  if (definition.max !== undefined && sayi > definition.max) {
    return {
      ok: false,
      message: `${definition.label}: en fazla ${definition.max} olabilir.`,
    };
  }

  return { ok: true, value: String(sayi) };
}
