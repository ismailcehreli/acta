import { z } from "zod";
import { formatInstant } from "@/shared/format/date-time";

// Yarım kalmış faaliyet metni (Görev 10.2).
//
// **"Taslak" denmiyor.** Veritabanındaki `DRAFT` onay durumuyla karışır; bu
// tamamen farklı bir şey: henüz hiç kaydedilmemiş, yalnız **cihazda** duran
// metin. Sunucuya gitmez.
//
// Bu dosya saf: DOM'a dokunmaz, tarayıcı API'si kullanmaz. Karar kuralları
// (bu taslak anlamlı mı, kaydedilmiş olandan farklı mı) burada durur ve
// testten geçer; React tarafı yalnız okuyup yazar.

export const activityDraftSchema = z.object({
  activityDate: z.string().max(20),
  title: z.string().max(150),
  description: z.string().max(10_000),
  targetDepartmentIds: z.array(z.string().uuid()).max(20),
  /** Kullanıcıya "ne zaman yazmıştım" demek için. */
  savedAt: z.string().datetime(),
});

export type ActivityDraft = z.infer<typeof activityDraftSchema>;

export interface DraftFields {
  activityDate: string;
  title: string;
  description: string;
  targetDepartmentIds: string[];
}

/**
 * Depodan okunan metni doğrular. **Doğrulanmadan kullanılmaz:** yerel depo
 * kullanıcının elinin altındadır, başka bir sürümün bıraktığı eski biçim de
 * olabilir. Bozuk kayıt sessizce yok sayılır — bu bir iş kuralı değil, bir
 * kolaylık özelliğidir; hata döndürüp kullanıcıyı durdurmak orantısız olurdu.
 */
export function parseDraft(raw: string | null): ActivityDraft | null {
  if (!raw) return null;

  try {
    const parsed = activityDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Kaydetmeye değer mi? Boş ya da yalnız boşluk olan metin saklanmaz. */
export function hasContent(fields: DraftFields): boolean {
  return fields.title.trim() !== "" || fields.description.trim() !== "";
}

/**
 * Geri getirmeyi **teklif etmeye** değer mi?
 *
 * Formda zaten aynı metin varsa teklif etmek anlamsız: kullanıcı düzeltme
 * ekranını açtığında "yarım kalmış kaydınız var" uyarısı görür ve o uyarı
 * kendi kaydettiği metinden bahsediyor olurdu.
 */
export function differsFromCurrent(
  draft: DraftFields,
  current: DraftFields,
): boolean {
  if (draft.title.trim() !== current.title.trim()) return true;
  if (draft.description.trim() !== current.description.trim()) return true;
  if (draft.activityDate !== current.activityDate) return true;

  const a = [...draft.targetDepartmentIds].sort();
  const b = [...current.targetDepartmentIds].sort();
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
}

/** Ne zaman yazıldığını insan diliyle söyler. */
export function savedAtLabel(savedAt: string, now: Date): string {
  const fark = now.getTime() - new Date(savedAt).getTime();
  const dakika = Math.floor(fark / 60_000);

  if (dakika < 1) return "az önce";
  if (dakika < 60) return `${dakika} dakika önce`;

  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} saat önce`;

  return formatInstant(new Date(savedAt));
}
