import type { UnitCalendarDb, UnitWorkWindow } from "./unit-calendar";

import { resolveUnitWorkWindow } from "./unit-calendar";

// Birim taşımanın **mesai penceresine etkisi** (denetim 23.08.2026,
// bulgu 14; tasarım Paket H).
//
// Taşıma yalnız ağaç görünümünü değiştirmiyor. Mesai penceresi üstten
// devralınıyor; birim başka bir dala geçince o birimdeki **herkesin**
// hatırlatma saati ve skor paydası kayıyor. Tasarım bu yüzden açık bir uyarı
// istiyor: *"Bu birim taşındığında mesai penceresi X'ten Y'ye değişecek."*
//
// Ekran yeni üstü seçer seçmez taşıyordu; sistem yöneticisi yan etkiyi
// görmeden işlemi tamamlıyordu.

export interface UnitMoveCalendarPreview {
  /** Bugünkü pencere. */
  mevcut: UnitWorkWindow;
  /** Taşımadan sonra geçerli olacak pencere. */
  yeni: UnitWorkWindow;
  /** İkisi farklı mı; aynıysa onay istenmez. */
  degisiyor: boolean;
  /**
   * Önizlemenin parmak izi.
   *
   * Onay bu değeri taşıyor ve sunucu **yeniden hesaplayıp** karşılaştırıyor:
   * kullanıcı "07:00–17:00'den 09:00–18:00'e" cümlesini okuyup onayladıktan
   * sonra araya giren bir takvim değişikliği, onaylanan cümleyi yanlış
   * kılardı.
   */
  imza: string;
}

/** Pencereyi karşılaştırılabilir tek bir metne indirger. */
export function workWindowSignature(pencere: UnitWorkWindow): string {
  return [
    [...pencere.workingDays].sort((a, b) => a - b).join("-"),
    pencere.workStartMinute,
    pencere.workEndMinute,
    pencere.worksOnHolidays ? "tatil" : "tatilsiz",
  ].join("|");
}

/**
 * Taşımadan önce ve sonra geçerli olacak pencereler.
 *
 * **Kendi takvimi olan birim etkilenmez**: pencere üstten devralınmıyorsa
 * taşıma onu değiştirmez ve gereksiz bir onay adımı istemek, uyarının
 * kendisini gürültüye çevirirdi.
 */
export async function previewUnitMoveCalendar(
  db: UnitCalendarDb,
  unitId: string,
  newParentId: string,
): Promise<UnitMoveCalendarPreview> {
  const mevcut = await resolveUnitWorkWindow(db, unitId);

  if (mevcut.source === "unit") {
    return {
      mevcut,
      yeni: mevcut,
      degisiyor: false,
      imza: `${workWindowSignature(mevcut)}=>${workWindowSignature(mevcut)}`,
    };
  }

  // Devralınan pencere yeni üstün zincirinden gelecek. Yeni üstün **kendi**
  // satırı varsa bizim için o "devralınan"dır; adı da oradan gelir.
  const ustPencere = await resolveUnitWorkWindow(db, newParentId);
  const yeni: UnitWorkWindow =
    ustPencere.source === "company"
      ? { ...ustPencere }
      : {
          ...ustPencere,
          source: "inherited",
          sourceUnitName:
            ustPencere.source === "unit"
              ? await birimAdi(db, newParentId)
              : ustPencere.sourceUnitName,
        };

  const mevcutImza = workWindowSignature(mevcut);
  const yeniImza = workWindowSignature(yeni);

  return {
    mevcut,
    yeni,
    degisiyor: mevcutImza !== yeniImza,
    imza: `${mevcutImza}=>${yeniImza}`,
  };
}

async function birimAdi(db: UnitCalendarDb, id: string): Promise<string | null> {
  const birim = await db.orgUnit.findUnique({ where: { id }, select: { name: true } });
  return birim?.name ?? null;
}
