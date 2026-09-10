import { Prisma } from "@prisma/client";

// Veritabanı kısıt hatalarının okunması.
//
// İş kuralının bir kısmı veritabanında duruyor (kısmi tekil indeks, trigger,
// CHECK). Bunlar `RAISE EXCEPTION 'AD: açıklama'` biçiminde hata atar ve
// uygulama katmanı o adı görüp kullanıcıya doğru cümleyi söyler.
//
// **Neden ayrı bir modül:** hata metninde çıplak dizge aramak üretimde yanlış
// cevap veriyordu. Prisma, paketlenmiş kodda hata mesajının başına çağrının
// geçtiği **minifiye modül kaynağını** ekliyor; o kaynakta `includes("AD")`
// satırları da geçtiği için metin, hiç oluşmamış bir kısıt ihlalini
// içeriyormuş gibi görünüyordu. Sonuç: aynı e-postayla ikinci kez kullanıcı
// eklenmeye çalışıldığında sistem yöneticisi "bu e-posta zaten kayıtlı"
// yerine "pasif bir birime aktif kullanıcı bağlanamaz" mesajını alıyordu
// (22.08.2026'da yakalandı).
//
// Bu hata **yalnız üretim derlemesinde** vardı: testler bundle'lanmamış kodla
// koşuyor ve orada mesaj yalnız veritabanı hatasını taşıyor. Bu yüzden çeviri
// ayrı ve saf olarak sınanıyor (`tests/db/kisit-hatasi.test.ts`).

/** Hata nesnesinden okunabilir metin. */
function metin(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Belirtilen veritabanı kısıtı gerçekten ihlal edilmiş mi?
 *
 * Ad **iki noktayla birlikte** aranır (`AD:`), çünkü tetikleyicilerin attığı
 * mesaj o biçimdedir. Kaynak kodda ad çıplak geçer (`includes("AD")`), iki
 * noktayla geçmez; ayrım bu.
 */
export function hasDatabaseSentinel(error: unknown, sentinel: string): boolean {
  return metin(error).includes(`${sentinel}:`);
}

/**
 * Tekil kısıt ihlali mi?
 *
 * Metne değil Prisma'nın **hata koduna** bakar (P2002). `field` verilirse
 * ihlalin o kolonda olduğu da doğrulanır.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    // Sarmalanmış hatalarda kod okunamıyor; metne düşülür ama dar bir
    // kalıpla — çıplak bir kelime aramakla aynı şey değil.
    const t = metin(error);
    if (!/Unique constraint failed on the fields?: \(/.test(t)) return false;
    return field === undefined || t.includes(field);
  }

  if (error.code !== "P2002") return false;
  if (field === undefined) return true;

  const hedef = error.meta?.target;
  return Array.isArray(hedef)
    ? hedef.includes(field)
    : String(hedef ?? "").includes(field);
}

/**
 * PostgreSQL **dışlama kısıtı** (EXCLUDE) ihlali mi?
 *
 * `NoActivityPeriod_no_overlap` gibi kısıtlar tetikleyici değildir: mesajı
 * veritabanı üretir ve `AD:` biçiminde gelmez. Çıplak ad aramak da olmaz —
 * paketlenmiş kaynakta o ad zaten geçiyor (bulgu 11'in tam sebebi).
 *
 * Bu yüzden iki şey birden aranıyor: SQLSTATE **23P01** (`exclusion_violation`)
 * ve kısıt adının veritabanı mesajındaki **tırnaklı** biçimi. Desendeki `\s*`
 * paketlenmiş kaynakta düz metin olarak durur ve kendi kendine eşleşmez;
 * `hasDatabaseSentinel`'in iki nokta hilesiyle aynı fikir.
 */
export function isExclusionViolation(error: unknown, constraint: string): boolean {
  const t = metin(error);

  if (!/code:\s*"23P01"/.test(t)) return false;

  return t.includes(`exclusion constraint \\"${constraint}\\"`)
    || t.includes(`exclusion constraint "${constraint}"`);
}
