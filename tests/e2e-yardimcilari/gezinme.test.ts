import { describe, expect, it } from "vitest";

import {
  beklenenYonlendirmeliGoto,
  BeklenmeyenYonlendirme,
  dayanikliGoto,
} from "../../e2e/gezinme";

// Gezinme iptalini sınıflandıran yardımcı (denetim 23.08.2026,
// bulgu 12).
//
// Sökülen küresel `page.goto` sarmalayıcısı **bütün** gezinme iptallerini
// yutuyordu: uygulamanın kendi yönlendirmesi istenen gezinmeyi iptal
// ettiğinde de hata metni aynı desene uyuyor, sarmalayıcı yönlendirmeyi hiç
// incelemeden istenen adresi yeniden zorluyordu. Yetki, oturum ve sunucu
// eylemi yönlendirmeleri tam da uçtan uca testin ölçmesi gereken davranış.
//
// Buradaki sahte sayfa gerçek yarışı taklit ediyor: `goto` "başka bir gezinme
// araya girdi" diye patlıyor. Ayrımı yapan şey, iptal anında sayfanın nerede
// olduğu.

const IPTAL_CHROMIUM = new Error(
  "page.goto: net::ERR_ABORTED; navigation interrupted by another navigation",
);
const IPTAL_FIREFOX = new Error(
  "page.goto: NS_BINDING_ABORTED; maybe frame was detached?",
);

interface Adim {
  /** Bu çağrıda fırlatılacak hata. */
  hata?: Error;
  /** Hata fırlamadan önce sayfanın kaydığı adres (rakip gezinme). */
  kayilanAdres?: string;
  /** `goto` normal döndüğünde tarayıcının vardığı adres (yönlendirme). */
  varisAdresi?: string;
  /** İptalden sonra ana çerçevede gözlenen rakip gezinme. */
  gecikmeliKayilanAdres?: string;
}

function sahneSayfa(baslangic: string, adimlar: Adim[]) {
  let adres = baslangic;
  let sira = 0;
  let cagriSayisi = 0;
  let beklemeSayisi = 0;
  let gecikmeliKayilanAdres: string | undefined;
  const dinleyiciler = new Set<(cerceve: { url(): string }) => void>();
  const anaCerceve = { url: () => adres };

  function gezin(yeniAdres: string): void {
    adres = yeniAdres;
    for (const dinleyici of dinleyiciler) dinleyici(anaCerceve);
  }

  const page = {
    url: () => adres,
    mainFrame: () => anaCerceve,
    on(
      _olay: "framenavigated",
      dinleyici: (cerceve: { url(): string }) => void,
    ) {
      dinleyiciler.add(dinleyici);
    },
    off(
      _olay: "framenavigated",
      dinleyici: (cerceve: { url(): string }) => void,
    ) {
      dinleyiciler.delete(dinleyici);
    },
    async waitForTimeout() {
      beklemeSayisi += 1;
      if (gecikmeliKayilanAdres) {
        gezin(gecikmeliKayilanAdres);
        gecikmeliKayilanAdres = undefined;
      }
    },
    cagriSayisi: () => cagriSayisi,
    beklemeSayisi: () => beklemeSayisi,
    async goto(hedef: string) {
      cagriSayisi += 1;
      const adim = adimlar[sira] ?? {};
      sira += 1;

      if (adim.kayilanAdres) gezin(adim.kayilanAdres);
      gecikmeliKayilanAdres = adim.gecikmeliKayilanAdres;
      if (adim.hata) throw adim.hata;

      adres =
        adim.varisAdresi ??
        (hedef.startsWith("http") ? hedef : `http://sunucu${hedef}`);
      return `yanit:${adres}`;
    },
  };

  return page;
}

describe("dayanıklı goto", () => {
  it("ana çerçeve aynı sayfayı yenilediyse bir kez daha dener", async () => {
    // Firefox hata metninde rakip hedefi yazmıyor. Güvenli tekrarın kanıtı,
    // iptalden sonra ana çerçevede gözlenen aynı-sayfa yenilemesi.
    const page = sahneSayfa("http://sunucu/", [
      {
        hata: IPTAL_FIREFOX,
        gecikmeliKayilanAdres: "http://sunucu/",
      },
    ]);

    const yanit = await dayanikliGoto(page, "/activities/abc");

    expect(yanit).toBe("yanit:http://sunucu/activities/abc");
    expect(page.cagriSayisi()).toBe(2);
    expect(page.beklemeSayisi()).toBe(1);
  });

  it("hedefi bilinmeyen iptali sayfa eski adreste diye güvenli saymaz", async () => {
    const page = sahneSayfa("http://sunucu/", [{ hata: IPTAL_FIREFOX }]);

    await expect(dayanikliGoto(page, "/feed")).rejects.toThrow(
      /NS_BINDING_ABORTED/,
    );
    expect(page.cagriSayisi()).toBe(1);
  });

  it("uygulama başka bir adrese götürdüyse hata verir", async () => {
    // Rakip gezinme gerçek bir yönlendirme: sayfa /login'e düştü. Sökülen
    // sarmalayıcı bunu yutup /feed'i yeniden zorluyor ve yönlendirmeyi
    // görünmez kılıyordu.
    const page = sahneSayfa("http://sunucu/", [
      { hata: IPTAL_CHROMIUM, kayilanAdres: "http://sunucu/login" },
    ]);

    await expect(dayanikliGoto(page, "/feed")).rejects.toBeInstanceOf(
      BeklenmeyenYonlendirme,
    );
    // Yeniden denenmedi.
    expect(page.cagriSayisi()).toBe(1);
  });

  it("hata rakip hedefi yazıyorsa erken page.url değerine kanmaz", async () => {
    // Chromium/WebKit rakip /login hedefini hata metninde veriyor, fakat
    // `page.url()` hata yakalandığı anda hâlâ çıkış adresini döndürebiliyor.
    const page = sahneSayfa("https://sunucu/", [
      {
        hata: new Error(
          'page.goto: Navigation to "https://sunucu/feed" is interrupted by ' +
            'another navigation to "https://sunucu/login"',
        ),
      },
    ]);

    await expect(dayanikliGoto(page, "/feed")).rejects.toBeInstanceOf(
      BeklenmeyenYonlendirme,
    );
    expect(page.cagriSayisi()).toBe(1);
  });

  it("yönlendirme hatası nereye gidildiğini yazar", async () => {
    const page = sahneSayfa("http://sunucu/", [
      { hata: IPTAL_CHROMIUM, kayilanAdres: "http://sunucu/login?next=%2Ffeed" },
    ]);

    await expect(dayanikliGoto(page, "/feed")).rejects.toThrow(
      /İstenen: \/feed · Gidilen: http:\/\/sunucu\/login\?next=%2Ffeed/,
    );
  });

  it("hedefe varmışken gelen iptal yarış sayılır", async () => {
    // Gezinme tamamlandı, araya giren tazeleme yine de iptal hatası üretti.
    const page = sahneSayfa("http://sunucu/", [
      { hata: IPTAL_CHROMIUM, kayilanAdres: "http://sunucu/feed" },
    ]);

    await dayanikliGoto(page, "/feed");

    expect(page.cagriSayisi()).toBe(2);
  });

  it("gezinme iptali olmayan hata yutulmaz", async () => {
    const page = sahneSayfa("http://sunucu/", [
      { hata: new Error("page.goto: net::ERR_CONNECTION_REFUSED") },
    ]);

    await expect(dayanikliGoto(page, "/feed")).rejects.toThrow(
      /CONNECTION_REFUSED/,
    );
    expect(page.cagriSayisi()).toBe(1);
  });

  it("ikinci deneme de düşerse hata yukarı çıkar", async () => {
    // Tek tekrar; sonsuz denemek gerçek bir hatayı zaman aşımına çevirirdi.
    const page = sahneSayfa("http://sunucu/login", [
      {
        hata: IPTAL_FIREFOX,
        gecikmeliKayilanAdres: "http://sunucu/login",
      },
      { hata: IPTAL_FIREFOX },
    ]);

    await expect(dayanikliGoto(page, "/feed")).rejects.toThrow(
      /NS_BINDING_ABORTED/,
    );
    expect(page.cagriSayisi()).toBe(2);
  });

  it("yarış yokken tek çağrı yapılır ve yanıt döner", async () => {
    const page = sahneSayfa("http://sunucu/", []);

    expect(await dayanikliGoto(page, "/feed")).toBe("yanit:http://sunucu/feed");
    expect(page.cagriSayisi()).toBe(1);
  });
});

describe("beklenen yönlendirmeli goto", () => {
  // Bu yardımcının konusu, gezinmeyi iptal eden şeyin **iddianın kendisi**
  // olduğu durum: oturumu düşürülmüş sekmede `/` açılıyor ve sayfa girişe
  // atılıyor. Sökülen küresel sarmalayıcı burada istenen adrese yeniden
  // gidiyor, yani ürünün yönlendirmesini siliyordu.

  const IPTAL_HEDEFLI = new Error(
    'page.goto: Navigation to "https://sunucu/" is interrupted by another ' +
      'navigation to "https://sunucu/login"',
  );

  it("beklenen yönlendirme gerçekleştiyse geçer ve yeniden gitmez", async () => {
    const page = sahneSayfa("https://sunucu/panel", [{ hata: IPTAL_HEDEFLI }]);

    await beklenenYonlendirmeliGoto(page, "/", /\/login$/);

    // Tek çağrı: ikinci bir gezinme yönlendirmeyi silerdi.
    expect(page.cagriSayisi()).toBe(1);
  });

  it("başka bir yere yönlendirildiyse hata verir", async () => {
    const page = sahneSayfa("https://sunucu/panel", [
      {
        hata: new Error(
          'page.goto: Navigation to "https://sunucu/" is interrupted by ' +
            'another navigation to "https://sunucu/hata"',
        ),
      },
    ]);

    await expect(
      beklenenYonlendirmeliGoto(page, "/", /\/login$/),
    ).rejects.toBeInstanceOf(BeklenmeyenYonlendirme);
  });

  it("hedefi yazmayan tarayıcıda sayfanın konumuna bakılır", async () => {
    // Firefox yalnız NS_BINDING_ABORTED diyor; rakip hedefi vermiyor.
    const page = sahneSayfa("https://sunucu/panel", [
      { hata: IPTAL_FIREFOX, kayilanAdres: "https://sunucu/login" },
    ]);

    await beklenenYonlendirmeliGoto(page, "/", /\/login$/);
    expect(page.cagriSayisi()).toBe(1);
  });

  it("normal tamamlanan gerçek yönlendirmeyi doğrular", async () => {
    const page = sahneSayfa("https://sunucu/panel", [
      { varisAdresi: "https://sunucu/login" },
    ]);

    await beklenenYonlendirmeliGoto(page, "/", /\/login$/);
    expect(page.cagriSayisi()).toBe(1);
  });

  it("normal tamamlandıysa ama yönlendirme olmadıysa hata verir", async () => {
    const page = sahneSayfa("https://sunucu/panel", []);

    await expect(
      beklenenYonlendirmeliGoto(page, "/", /\/login$/),
    ).rejects.toBeInstanceOf(BeklenmeyenYonlendirme);
    expect(page.cagriSayisi()).toBe(1);
  });

  it("gezinme iptali olmayan hata yutulmaz", async () => {
    const page = sahneSayfa("https://sunucu/panel", [
      { hata: new Error("page.goto: net::ERR_CONNECTION_REFUSED") },
    ]);

    await expect(
      beklenenYonlendirmeliGoto(page, "/", /\/login$/),
    ).rejects.toThrow(/CONNECTION_REFUSED/);
  });
});
