// Baş harf düşüşü (Görev 11.5).
//
// Sunucuya bağlı olmayan saf bir işlev; hem yükleme yolunda hem de ekranda
// aynı harfleri üretsin diye paylaşılan katmanda duruyor.

/**
 * Resim yokken gösterilecek baş harfler: "Ahmet Yılmaz" → "AY".
 *
 * Büyütme **Türkçe kurallarıyla** yapılır: `toUpperCase()` varsayılan yerelde
 * "ışık" için "I" yerine "I" üretir ama "i" için "I" verir ve "İ" beklenirken
 * yanlış harf çıkar. Ad baş harfi ekranda kişiyi temsil ediyor; yanlış harf
 * doğrudan görünür bir hata olur.
 */
export function initials(fullName: string): string {
  const parcalar = fullName.trim().split(/\s+/).filter(Boolean);
  if (parcalar.length === 0) return "";

  const ilk = parcalar[0] as string;
  const son = parcalar.length > 1 ? (parcalar.at(-1) as string) : "";

  return `${ilk[0] ?? ""}${son[0] ?? ""}`.toLocaleUpperCase("tr-TR");
}
