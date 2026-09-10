import { test, expect, type Browser, type Page } from "@playwright/test";

// Uçtan uca testlerin ortak tabanı.
//
// **Burada gezinme sarmalayıcısı yok** (denetim 23.08.2026, bulgu 12).
//
// Önce vardı: `page.goto` küresel olarak sarılıyor ve **bütün** gezinme
// iptalleri sessizce yeniden deneniyordu. Gerekçe "yarışı tek yerde çöz"
// idi, ama sarmalayıcı iptalin sebebini hiç incelemiyordu. Uygulamanın
// yetki, oturum ya da sunucu eylemi yönlendirmesi istenen gezinmeyi iptal
// ettiğinde hata metni aynı desene uyuyor; sarmalayıcı yönlendirmeyi yutup
// istenen adresi bir kez daha zorluyor ve — yönlendirme tek seferlikse —
// ikinci deneme geçiyordu. Ürünün gerçekten yaptığı yönlendirme kayboluyor,
// sonraki beklentiler yanlış sayfada yeşil kalıyordu. Uçtan uca testin
// ölçmesi gereken davranış, altyapı gürültüsü sayılarak siliniyordu.
//
// Şimdi: gezinmeler `e2e/gezinme.ts` içindeki adı konmuş işlevlerden geçer.
// Onlar iptal anında sayfanın **nereye gittiğine** bakar; uygulamanın
// yönlendirmesini yeniden denemez, hata olarak yükseltir. Gerekçesi,
// ölçümleri ve neden birkaç çağrı yerine değil hepsine uygulandığı o
// dosyanın başında yazılı.

export { test, expect };
export type { Browser, Page };
