// Uçtan uca gezinmeler — iptali **sınıflandıran** tek yer (denetim
// 23.08.2026, bulgu 12).
//
// **Önce ne vardı.** `e2e/test-tabani.ts` içinde `page.goto` küresel olarak
// sarmalanıyor ve *her* gezinme iptali sessizce yeniden deneniyordu.
// Sarmalayıcı iptalin sebebine hiç bakmıyordu. Oysa istenen A gezinmesini
// iptal eden şey uygulamanın **kendi yönlendirmesi** de olabilir: yetkisiz
// erişimde girişe atma, oturum düşünce çıkışa atma, sunucu eyleminden sonra
// başka sayfaya götürme. O durumda hata metni aynı desene uyuyor;
// sarmalayıcı yönlendirmeyi yutup A'yı bir kez daha zorluyor ve yönlendirme
// tek seferlikse ikinci deneme geçiyordu. Ürünün gerçekten yaptığı şey
// kayboluyor, sonraki beklentiler yanlış sayfada yeşil kalıyordu — uçtan uca
// testin ölçmesi gereken davranış, altyapı gürültüsü sayılarak siliniyordu.
//
// **Şimdi ne var.** Sarmalayıcı söküldü. Gezinmeler bu dosyadaki adı konmuş
// işlevlerden geçer; `page.goto` maymun yamasıyla değiştirilmez. Karar,
// tarayıcının hata metninde bildirdiği rakip hedef ve ana çerçevede gerçekten
// gözlenen gezinme birlikte değerlendirilerek verilir. Uygulamanın
// yönlendirmesi hiçbir koşulda yutulmaz.
//
// **Neden her gezinmede, birkaç tanesinde değil.** Yarış tek tük değil.
// 24.08.2026'da Firefox ve WebKit koşularında altı ayrı yerde ölçüldü ve
// hepsi aynı sınıftandı:
//
//   | Nerede | Rakip gezinmenin hedefi |
//   |---|---|
//   | `onay.spec.ts:57` (sunucu eyleminden sonra) | `/admin/org` — sayfanın kendisi |
//   | `onay.spec.ts:110` (`/`'de bekleyen sekme) | `/` — sayfanın kendisi |
//   | `onay.spec.ts:206` (`/`'de bekleyen sekme) | `/` — sayfanın kendisi |
//   | `gercek-zamanli.spec.ts:96` | `/` — sayfanın kendisi |
//   | `organizasyon.spec.ts:164` (sunucu eyleminden sonra) | `/admin/org` |
//   | `profil.spec.ts:158` | `/` — sayfanın kendisi |
//   | `kullanicilar.spec.ts:235` | `/login` — **ürünün yönlendirmesi** |
//
// Sebep hep aynı: girişten sonra her sayfada `LiveRefresh` bileşeni duruyor
// ve akıştan gelen olay `router.refresh()` tetikliyor; bu tazeleme ara sıra
// tam sayfa yüklemesine dönüşüp bekleyen gezinmeyi iptal ediyor. Yani yarış,
// oturum açmış **her** sayfanın **her** gezinmesinde mümkün. Yalnız düşerken
// yakalanan yerleri yamamak, rastgele düşen bir takım bırakırdı; proje bunu
// açıkça kabul etmiyor (§18.4). Bu yüzden gezinmelerin tamamı buradan geçer
// — ama çağrı yerinde görünen, içe aktarılan, sınanmış bir işlevle.
//
// Son satır ürünün yönlendirmesi ve ayrımın niçin gerekli olduğunun kanıtı:
// orada beklenen sonuç zaten gerçekleşmişti, eski sarmalayıcı ise gidip onu
// siliyordu.

interface GezinebilirCerceve {
  url(): string;
}

/** Yardımcının ihtiyaç duyduğu asgari sayfa arayüzü; test edilebilir olsun diye dar. */
export interface GezinebilirSayfa<TYanit = unknown> {
  goto(adres: string, secenekler?: unknown): Promise<TYanit>;
  url(): string;
  mainFrame(): GezinebilirCerceve;
  on(
    olay: "framenavigated",
    dinleyici: (cerceve: GezinebilirCerceve) => void,
  ): unknown;
  off(
    olay: "framenavigated",
    dinleyici: (cerceve: GezinebilirCerceve) => void,
  ): unknown;
  waitForTimeout(milisaniye: number): Promise<void>;
}

// Her tarayıcı aynı durumu başka türlü adlandırıyor: Chromium ve WebKit
// "interrupted by another navigation", Firefox ise `NS_BINDING_ABORTED`.
// İkisi de "bekleyen gezinme iptal edildi" demek.
const GEZINME_IPTALLERI = ["interrupted by another navigation", "NS_BINDING_ABORTED"];

function gezinmeIptali(hata: unknown): boolean {
  const mesaj = hata instanceof Error ? hata.message : String(hata);
  return GEZINME_IPTALLERI.some((iz) => mesaj.includes(iz));
}

/** `/feed?a=1` ile `http://sunucu/feed?a=1` aynı sayılmalı. */
function ayniYol(sol: string, sag: string): boolean {
  try {
    let dayanak = "http://yerel";
    for (const aday of [sol, sag]) {
      try {
        dayanak = new URL(aday).href;
        break;
      } catch {
        // Göreli adres; diğer aday mutlak olabilir.
      }
    }

    const solUrl = new URL(sol, dayanak);
    const sagUrl = new URL(sag, dayanak);
    return (
      solUrl.origin === sagUrl.origin &&
      solUrl.pathname === sagUrl.pathname &&
      solUrl.search === sagUrl.search
    );
  } catch {
    return sol.split("#")[0] === sag.split("#")[0];
  }
}

function deseneUyar(deger: string, desen: RegExp): boolean {
  desen.lastIndex = 0;
  return desen.test(deger);
}

/**
 * İptal metni rakip hedefi yazıyorsa onu çıkarır.
 *
 * Chromium ve WebKit *"interrupted by another navigation to <adres>"* diyor;
 * Firefox yalnız `NS_BINDING_ABORTED` diyor ve hedefi vermiyor. Hedef
 * yazılıysa ona bakmak `page.url()` okumasından daha kesin: rakip gezinme
 * henüz yerleşmemişse `url()` eski adresi döndürebilir.
 */
function iptalinHedefi(hata: unknown): string | null {
  const mesaj = hata instanceof Error ? hata.message : String(hata);
  const eslesme = /interrupted by another navigation to "([^"]+)"/.exec(mesaj);
  return eslesme?.[1] ?? null;
}

export class BeklenmeyenYonlendirme extends Error {
  constructor(
    readonly hedef: string,
    readonly gidilen: string,
  ) {
    super(
      "Gezinme iptal edildi ve sayfa beklenmeyen bir adrese gitti. " +
        `İstenen: ${hedef} · Gidilen: ${gidilen}. ` +
        "Oraya uygulama götürdü; bu testin ölçmesi gereken davranış olduğu " +
        "için yeniden denenmiyor.",
    );
  }
}

/**
 * `page.goto`, yalnız **ispatlanmış** bir gezinme yarışında bir kez tekrarlanır.
 *
 * Uygulamanın yönlendirmesi yeniden denenmez; hata olarak çıkar. İkinci deneme
 * de düşerse hata olduğu gibi yukarı gider — sayfa gerçekten açılmıyorsa test
 * yine kırılır. Susturulan şey yarış, başarısızlık değil.
 *
 * Bütün test gezinmeleri bu açıkça içe aktarılan yardımcıdan geçer; dolayısıyla
 * hiçbir çağrı yeri iptali sessizce yutan eski küresel maymun yamasına bağlı
 * değildir. Yardımcı yalnız kanıtlı aynı-sayfa yarışını yeniden dener.
 */
export async function dayanikliGoto<TYanit>(
  page: GezinebilirSayfa<TYanit>,
  adres: string,
  secenekler?: unknown,
): Promise<TYanit> {
  const cikisAdresi = page.url();
  let gozlenenAnaCerceveHedefi: string | null = null;
  const anaCerceve = page.mainFrame();
  const gezinmeDinleyicisi = (cerceve: GezinebilirCerceve): void => {
    if (cerceve === anaCerceve) gozlenenAnaCerceveHedefi = cerceve.url();
  };

  page.on("framenavigated", gezinmeDinleyicisi);

  try {
    return await page.goto(adres, secenekler);
  } catch (hata) {
    if (!gezinmeIptali(hata)) throw hata;

    // Chromium/WebKit'in hata hedefi `page.url()` değerinden daha kesin:
    // rakip yönlendirme başlamış, URL henüz eski adreste olabilir.
    let rakipHedef = iptalinHedefi(hata);

    if (!rakipHedef) {
      // Firefox hedefi hata metnine yazmıyor. Ana çerçeve olayının yerleşmesi
      // için çok kısa beklenir; kanıt yoksa eski URL'yi "yerinde kaldı" diye
      // yorumlayıp güvenli saymak, asıl yanlış-yeşil sınıfını geri getirir.
      await page.waitForTimeout(50);
      const suAn = page.url();
      rakipHedef =
        gozlenenAnaCerceveHedefi ??
        (!ayniYol(suAn, cikisAdresi) ? suAn : null);

      if (!rakipHedef) throw hata;
    }

    const guvenliYaris =
      ayniYol(rakipHedef, cikisAdresi) || ayniYol(rakipHedef, adres);

    // Sayfa başka bir yere gittiyse bunu uygulama yaptı: yutulmaz.
    if (!guvenliYaris) throw new BeklenmeyenYonlendirme(adres, rakipHedef);
  } finally {
    page.off("framenavigated", gezinmeDinleyicisi);
  }

  return await page.goto(adres, secenekler);
}

/**
 * Uygulamanın **beklenen** yönlendirmesiyle yarışan gezinme.
 *
 * Bazı gezinmelerin varış yeri istenen adres değil; testin iddiası zaten
 * uygulamanın bizi başka bir yere atması. Oturumu düşürülmüş bir sekmede
 * `/` açmak böyle: sunucu girişe yönlendiriyor. Sayfanın kendi canlı akışı
 * aynı yönlendirmeyi bizden **önce** başlatırsa bekleyen gezinme iptal
 * ediliyor ve `page.goto` hata veriyor — beklenen sonuç gerçekleşmiş olsa
 * bile (24.08.2026, WebKit, `kullanicilar.spec.ts:235`).
 *
 * Sökülen küresel sarmalayıcı bu durumda istenen adrese **yeniden**
 * gidiyordu; yani ürünün yönlendirmesini geri alıp yerine kendi gezinmesini
 * koyuyordu. Buradaki yardımcı tam tersini yapar: yönlendirmeyi korur,
 * yalnız beklenen hedefe uyup uymadığına bakar. Uymuyorsa hata verir —
 * çağıran, hangi yönlendirmeyi beklediğini yazmak zorunda olduğu için
 * iddiayı atlamak mümkün değil.
 *
 * Tekrar yok: ikinci bir gezinme, ölçülmek istenen yönlendirmeyi silerdi.
 */
export async function beklenenYonlendirmeliGoto<TYanit>(
  page: GezinebilirSayfa<TYanit>,
  adres: string,
  beklenen: RegExp,
): Promise<void> {
  try {
    await page.goto(adres);
    const gidilen = page.url();
    if (!deseneUyar(gidilen, beklenen)) {
      throw new BeklenmeyenYonlendirme(adres, gidilen);
    }
  } catch (hata) {
    if (hata instanceof BeklenmeyenYonlendirme) throw hata;
    if (!gezinmeIptali(hata)) throw hata;

    const gidilen = iptalinHedefi(hata) ?? page.url();
    if (!deseneUyar(gidilen, beklenen)) {
      throw new BeklenmeyenYonlendirme(adres, gidilen);
    }
  }
}
