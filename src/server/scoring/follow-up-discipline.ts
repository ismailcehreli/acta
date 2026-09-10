// Takip disiplini boyutunun **saf** kuralları (Görev 11.10; denetim
// 23.08.2026, bulgu 6 ve P3-1/P3-2).
//
// Tasarım (satır 559) boyutu iki işle tanımlıyor: **gelen soruları
// cevaplama** ve **açtığı maddeleri kapatma**. İkisinin de ölçümü üç kez
// yanlış kuruldu ve üçünün de sebebi aynıydı: **güncel durum, geçmiş dönemin
// kanıtı değildir.**
//
//   · Konuşmada yalnız `responsibleId` okunuyordu. O alan "iş şu an kimde"
//     demek ve her mesajda el değiştiriyor (§9.2); zamanında cevaplanan soru
//     kişinin hem payından hem paydasından birlikte düşüyor, yani **doğru
//     cevap vermek hiçbir şey getirmiyordu.**
//   · Maddeler devredilebilir `ownerId` ile ilişkilendiriliyordu; devir,
//     geçmiş performansın sahibini değiştiriyordu.
//   · Maddenin güncel `lastMovedAt` alanı okunuyordu: eylülde gelen bir
//     hareket ağustosun başarısızlığını başarıya çeviriyordu.
//
// Bu dosyadaki kurallar yalnız **değişmez** verilere bakar: mesaj anları,
// açılış anı ve olay geçmişi. Dönem kapandıktan sonra sonuç değişmez.

/** Bir takip maddesinin dönem sonuna kadar olan durum olayları. */
export interface MaddeGorunumu {
  openedAt: Date;
  /** Yalnız `CLOSED` ve `REOPENED`, artan sırada. */
  olaylar: { kind: string; createdAt: Date }[];
}

/**
 * Maddenin verilen ana kadar kapanıp kapanmadığı.
 *
 * Güncel `status`/`closedAt` kolonları değil olay geçmişi okunuyor: kapatılıp
 * yeniden açılan bir madde için kolon **son** kapanışı gösterir ve geçmiş
 * dönem yanlış hesaplanırdı.
 */
export function maddeKapanisi(madde: MaddeGorunumu): Date | null {
  let kapanis: Date | null = null;

  for (const olay of madde.olaylar) {
    if (olay.kind === "CLOSED") kapanis = olay.createdAt;
    if (olay.kind === "REOPENED") kapanis = null;
  }

  return kapanis;
}

export interface KonusmaGorunumu {
  askerId: string;
  /** Konuşmanın sabit cevaplayan tarafı: faaliyeti yazan kişi (§9.2). */
  respondentId: string;
  openedAt: Date;
  /** Dönem sonundan **önce** kapandıysa kapanış anı, yoksa `null`. */
  kapanis: Date | null;
  /** Dönem sonuna kadarki mesajlar, artan sırada. */
  mesajlar: { authorId: string; createdAt: Date }[];
}

/**
 * Cevap borcunun nasıl sona erdiği.
 *
 * `CEVAPLANDI` kişinin **kendi mesajıdır**. `KAPANDI` konuşmanın cevap
 * yazılmadan kapanmasıdır: soran her zaman kapatabilir, sistem yöneticisi
 * gerekçeyle idari kapatabilir — ikisi de kişinin eylemi değildir.
 * `DONEM_SONU` ise borcun hâlâ açık olmasıdır.
 */
export type YukumlulukSonu = "CEVAPLANDI" | "KAPANDI" | "DONEM_SONU";

/** Cevap borcunun doğduğu ve kapandığı an. */
export interface CevapYukumlulugu {
  basladi: Date;
  bitti: Date;
  sonu: YukumlulukSonu;
}

/**
 * Kişinin bu konuşmada cevap borçlu olduğu turlar.
 *
 * Taraflar **sabittir**: soran ve faaliyeti yazan. Karşı tarafın yazdığı her
 * mesaj dizisi bir tur açar; borç, kişinin bir sonraki mesajıyla, konuşmanın
 * kapanmasıyla ya da ölçüm anıyla kapanır.
 *
 * Turun başlangıcı dizinin **son** mesajıdır: §12.2 sayacı da sorumluluğun
 * son el değiştirdiği andan işler ve iki ölçünün ayrışması, sistemin
 * "gecikti" derken skorun "zamanında" demesi olurdu.
 */
export function cevapYukumlulukleri(
  konusma: KonusmaGorunumu,
  kisiId: string,
  /** Ölçümün yapıldığı an; bu andan sonraki mesajlar zaten verilmez. */
  olcumAni: Date,
): CevapYukumlulugu[] {
  const taraflar = [konusma.askerId, konusma.respondentId];
  if (!taraflar.includes(kisiId)) return [];

  const karsi =
    kisiId === konusma.askerId ? konusma.respondentId : konusma.askerId;

  const sonAn = konusma.kapanis && konusma.kapanis < olcumAni
    ? konusma.kapanis
    : olcumAni;

  const yukumlulukler: CevapYukumlulugu[] = [];
  let turBasi: Date | null = null;

  for (const mesaj of konusma.mesajlar) {
    if (mesaj.authorId === kisiId) {
      // Kişi yazdı: varsa açık borç bu anda kapanır.
      if (turBasi) {
        yukumlulukler.push({
          basladi: turBasi,
          bitti: mesaj.createdAt,
          sonu: "CEVAPLANDI",
        });
        turBasi = null;
      }
      continue;
    }

    if (mesaj.authorId === karsi) {
      // Karşı taraf yazdı: borç doğar, art arda mesajlarda **sonuncusu**
      // sayacı yeniden başlatır.
      turBasi = mesaj.createdAt;
    }
  }

  if (turBasi) {
    const kapandi = konusma.kapanis !== null && konusma.kapanis < olcumAni;
    yukumlulukler.push({
      basladi: turBasi,
      bitti: sonAn,
      sonu: kapandi ? "KAPANDI" : "DONEM_SONU",
    });
  }

  return yukumlulukler;
}

/** Yükümlülük dönemle kesişiyor mu (yarı açık aralık). */
export function donemeGiriyorMu(
  yukumluluk: CevapYukumlulugu,
  donemBasi: Date,
  donemSonu: Date,
): boolean {
  return yukumluluk.basladi < donemSonu && yukumluluk.bitti > donemBasi;
}

/**
 * Maddenin verilen ana kadarki **son hareketi**.
 *
 * Ana tasarım §11.1 "hareketsiz kaç gün" hesabını son hareketten yapıyor ve
 * üretim `touchFollowUps` faaliyete yorum/cevap geldiğinde maddeyi tazeliyor.
 * Güncel `lastMovedAt` sütunu geçmiş dönemde kullanılamaz — sonraki ayda
 * gelen bir hareket geçmişi değiştirirdi; hareket bu yüzden olay geçmişinden
 * çözülüyor.
 */
export function maddeSonHareketi(madde: MaddeGorunumu): Date {
  return madde.olaylar.reduce(
    (son, olay) => (olay.createdAt > son ? olay.createdAt : son),
    madde.openedAt,
  );
}
