import { z } from "zod";

import { emailSchema, passwordSchema } from "./auth";

// Kullanıcı yönetimi girdileri (§4.6, §15.1).

export const fullNameSchema = z
  .string()
  .trim()
  .min(3, "Ad soyad en az 3 karakter olmalı")
  .max(150, "Ad soyad en fazla 150 karakter olabilir");

/**
 * Unvan. İsteğe bağlı ve **yetki değildir**: görünürlük ile onay ağaçtan
 * gelir. Boş bırakılan unvan `null` olarak saklanır — boş dize ile `null`
 * arasında ayrım tutmak, listelerde iki farklı "boş" hâli demek olurdu.
 */
export const titleSchema = z
  .string()
  .trim()
  .max(100, "Unvan en fazla 100 karakter olabilir")
  .transform((deger) => (deger === "" ? null : deger))
  .nullable()
  .optional();

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  title: titleSchema,
  email: emailSchema,
  orgUnitId: z.string().uuid("Birim seçilmeli"),
  /**
   * Birim yöneticisi mi. Bir birimde **birden fazla** olabilir
   * (20.08.2026 kararı): kayıt hepsinin kuyruğuna düşer, ilk karar veren
   * kapatır.
   */
  isUnitManager: z.boolean().default(false),
  /** İşlevsel yetki; içerik erişimi vermez (§15.1). */
  isSystemAdmin: z.boolean().default(false),
  /** Organizasyon kapsamındaki toplu raporları görebilir mi? */
  canViewReports: z.boolean().default(false),
  /** Skor ve takdir raporlarını görebilir mi? */
  canViewScoreReports: z.boolean().default(false),
  /**
   * Bu kişiden günlük faaliyet beklenir mi? Yönetim Kurulu üyeleri gibi
   * yazmayan roller için `false` (ürün sahibi kararı, 19.08.2026).
   */
  /** Skoru hesaplanır mı (Görev 11.10). */
  isScored: z.boolean().default(true),
  /** Faaliyetlere takdir verebilir mi (Görev 11.11). */
  canAppreciate: z.boolean().default(false),
  writesActivities: z.boolean().default(true),
  /** Başlangıç parolası; kullanıcı ilk girişten sonra değiştirebilir. */
  initialPassword: passwordSchema,
});

export const deactivateUserSchema = z.object({
  id: z.string().uuid(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Pasifleştirme öncesi açık konuşmaların gerekçeli kapatılması (§4.6, §9.3). */
export const closeConversationsForUserSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Kapatma gerekçesi zorunludur")
    .max(500, "Gerekçe en fazla 500 karakter olabilir"),
});

/** Kullanıcı bilgisi düzenleme (§4.6). Parola ayrı bir akıştır. */
export const updateUserSchema = z.object({
  id: z.string().uuid(),
  fullName: fullNameSchema,
  title: titleSchema,
  email: emailSchema,
  orgUnitId: z.string().uuid("Birim seçilmeli"),
  isUnitManager: z.boolean().default(false),
  isSystemAdmin: z.boolean().default(false),
  canViewReports: z.boolean().default(false),
  canViewScoreReports: z.boolean().default(false),
  /** Skoru hesaplanır mı (Görev 11.10). */
  isScored: z.boolean().default(true),
  /** Faaliyetlere takdir verebilir mi (Görev 11.11). */
  canAppreciate: z.boolean().default(false),
  writesActivities: z.boolean().default(true),
});

/** Ana hesabın kendi ekranından değiştirebileceği dar alanlar. */
export const rootSelfUpdateSchema = z.object({
  id: z.string().uuid(),
  orgUnitId: z.string().uuid("Birim seçilmeli"),
  /** Root'un günlük faaliyet beklentisi. */
  writesActivities: z.boolean(),
  /** Root'un skoru hesaplansın mı. */
  isScored: z.boolean(),
  /** Root takdir verebilsin mi. */
  canAppreciate: z.boolean(),
  /** Root yönetim raporlarını görebilsin mi. */
  canViewReports: z.boolean(),
  /** Root skor ve takdir raporlarını görebilsin mi. */
  canViewScoreReports: z.boolean(),
});

/**
 * Bölüm müdürünün düzenleyebildiği alanlar.
 *
 * Tasarım müdüre kendi alt ağacında **ad ve unvan** düzenlemesi veriyor
 * (Paket F yetki tablosu). Başka hiçbir alan onun değil; bu yüzden müdür
 * yolu tam şemayı hiç görmüyor. Fazla alanı "temizlemek" yerine **hiç
 * kabul etmemek** tercih edildi: temizleyen kod, yeni bir alan eklendiğinde
 * güncellenmeyi bekler ve unutulur.
 */
/**
 * Bölüm müdürünün **ekleme** için verebildiği alanlar.
 *
 * Bayraklar ve roller listede yok: onları sunucu belirler. Müdürün
 * formunda kutu olmaması yeterli değildi — ilk denemede kutuyu kaldırdım ama
 * eylem "işaretlenmemiş" diye `false` yazdı ve müdürün eklediği personelden
 * faaliyet beklenmez oldu (23.08.2026, ikinci denetim turu).
 */
export const managerCreateUserSchema = z.object({
  fullName: fullNameSchema,
  title: titleSchema,
  email: emailSchema,
  orgUnitId: z.string().uuid("Birim seçilmeli"),
});

export type ManagerCreateUserInput = z.infer<typeof managerCreateUserSchema>;

export const managerUpdateUserSchema = z.object({
  id: z.string().uuid(),
  fullName: fullNameSchema,
  title: titleSchema,
});

export type ManagerUpdateUserInput = z.infer<typeof managerUpdateUserSchema>;

/** Sistem yöneticisinin bir kullanıcıya parola belirlemesi (§15.1, §15.3). */
export const setUserPasswordSchema = z.object({
  id: z.string().uuid(),
  newPassword: passwordSchema,
});
