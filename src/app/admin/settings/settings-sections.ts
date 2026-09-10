export const SETTINGS_SECTIONS = [
  {
    slug: "general",
    label: "Genel ve faaliyet",
    description: "Faaliyet metinleri, geçmişe dönük giriş ve izin günü ayarları.",
    groups: ["Faaliyet girişi", "İzin ve faaliyet dışı günler"],
  },
  {
    slug: "approval",
    label: "Onay ve takip",
    description: "Onay, soru-cevap ve takip maddelerinde kullanılan süreler.",
    groups: ["Onay akışı", "Soru–cevap", "Takip maddeleri"],
  },
  {
    slug: "notifications",
    label: "Bildirimler",
    description: "Hangi olaylarda, hangi kanaldan ve ne sıklıkta haber verileceği.",
    groups: ["Bildirimler"],
  },
  {
    slug: "scoring",
    label: "Skor",
    description: "Skor sistemi, puan dağılımı ve sıralama seçenekleri.",
    groups: ["Skor"],
  },
  {
    slug: "accounts",
    label: "Hesaplar ve güvenlik",
    description: "E-posta alan adları, oturum süresi ve hesap kilidi.",
    groups: ["Kullanıcı hesapları", "Oturum ve güvenlik"],
  },
  {
    slug: "files",
    label: "Dosya ekleri",
    description: "Faaliyetlere eklenebilecek dosyaların boyut ve adet sınırları.",
    groups: ["Dosya ekleri"],
  },
  {
    slug: "delivery",
    label: "E-posta ve tarayıcı",
    description: "SMTP gönderimi ve tarayıcı bildirimlerinin teknik kurulumu.",
    groups: [],
  },
  {
    slug: "customization",
    label: "Özelleştirme",
    description: "Logo, sayfa başlığı ve alt şerit metni.",
    groups: [],
  },
  {
    slug: "demo",
    label: "Örnek veri",
    description: "Sistemi tanımak için örnek şirket verilerini kurma ve temizleme.",
    groups: [],
  },
  {
    slug: "reset",
    label: "Başlangıca dönüş",
    description: "Uygulama verilerini temizleyip yeni bir başlangıç yöneticisi oluşturma.",
    groups: [],
  },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function findSettingsSection(
  slug: string,
): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.slug === slug);
}
