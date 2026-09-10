import { PrismaClient } from "@prisma/client";

import { activityMaintenanceReader } from "@/server/authz/activity-repository";
import { companyDay, toDateValue } from "@/server/activities/date-rules";
import { isBusinessDay } from "@/server/calendar/business-days";
import { askQuestion, replyToConversation } from "@/server/conversations/service";
import { closeFollowUp, openFollowUp } from "@/server/follow-ups/service";
import {
  decideNoActivityPeriod,
  markOwnNoActivityPeriod,
} from "@/server/absence/service";
import { createHelpArticle } from "@/server/help/articles";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { createOrgUnit } from "@/server/org/tree";
import { resolveManagers } from "@/server/org/resolve-manager";
import { createUser } from "@/server/users/create";

import {
  DEMO_EMAIL_DOMAIN,
  DEMO_ORIGIN_CREATED,
  DEMO_ORIGIN_REUSED,
  rememberDemoOrgUnitOrigin,
} from "./origin";

export { DEMO_EMAIL_DOMAIN } from "./origin";

// Örnek (demo) veri: kurulum, yönetim ekranı ve elle deneme için.
//
// Boş bir sistem, ekranların çalıştığını göstermez: kapsam akışı, arama,
// okundu bilgisi, onay kuyruğu ve takip listeleri ancak gerçekçi bir şirkette
// anlaşılır. Bu modül uygulamanın **bütün özelliklerini** kapsayan bir örnek
// şirket kurar.
//
// **Yalnızca eksik olanı kurar**; mevcut veriye dokunmaz, ikinci kez
// çalıştırmak zararsızdır.
//
// Faaliyetler doğrudan yazılır — `createActivity` geçmişe dönük giriş
// penceresini uygular ve on günlük geçmiş kurulamazdı. Konuşmalar ve takip
// maddeleri ise **gerçek servisten** geçer: görünürlük ve sorumluluk kuralları
// örnek veride de aynen işlesin.
//
// Demo verisinin tamamı `@ornek.test` alan adına bağlıdır; temizleme işlemi
// bu damgayı kullanır (bkz. `purge.ts`).

export const DEMO_DEFAULT_PASSWORD = "ornek-parola-1234";

/** Kaç iş günü geriye örnek faaliyet yazılacağı. */
const GUN_SAYISI = 12;

export interface InstallOptions {
  /** Örnek hesapların parolası. */
  password?: string;
  /** İlerleme satırları; verilmezse hiçbir yere yazılmaz. */
  onLog?: (message: string) => void;
}

export type InstallResult =
  | { ok: true; log: string[] }
  | { ok: false; error: "no_root"; log: string[] };

interface KisiTanimi {
  ad: string;
  eposta: string;
  birim: string;
  /** Unvan; yetki değildir, yalnız kim olduğunu anlatır. */
  unvan?: string;
  yonetici?: boolean;
  /** Bu kişiden günlük faaliyet bekleniyor mu; varsayılan evet. */
  yazar?: boolean;
  sistemYoneticisi?: boolean;
  /** Bu kişinin dönemsel skoru hesaplanır mı; varsayılan evet. */
  isScored?: boolean;
  /** Bu kişi onaylı faaliyetlere takdir verebilir mi; varsayılan hayır. */
  canAppreciate?: boolean;
}

const BIRIMLER = [
  { ad: "Yönetim Kurulu", ust: "kök", tur: "Yönetim Kurulu", onay: false },
  { ad: "Genel Müdürlük", ust: "Yönetim Kurulu", tur: "Genel Müdürlük", onay: false },
  {
    ad: "Satın Alma ve İdari İşler Koordinatörlüğü",
    ust: "Genel Müdürlük",
    tur: "Koordinatörlük",
    onay: false,
  },
  { ad: "Satın Alma", ust: "Satın Alma ve İdari İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Hukuk", ust: "Satın Alma ve İdari İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "İdari İşler", ust: "Satın Alma ve İdari İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Mali İşler Koordinatörlüğü", ust: "Genel Müdürlük", tur: "Koordinatörlük", onay: false },
  { ad: "Global Finans", ust: "Mali İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Muhasebe", ust: "Mali İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Finans", ust: "Mali İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Denetim", ust: "Mali İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Cari Hesaplar", ust: "Mali İşler Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Lojistik Koordinatörlüğü", ust: "Genel Müdürlük", tur: "Koordinatörlük", onay: false },
  { ad: "Bilgi İşlem", ust: "Lojistik Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Dış Ticaret", ust: "Lojistik Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Depo ve Sevkiyat", ust: "Lojistik Koordinatörlüğü", tur: "Departman", onay: true },
  { ad: "Satış, Pazarlama ve İş Geliştirme", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "İnsan Kaynakları", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "Kalite Kontrol", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "Sosyal Uygunluk ve Çevre", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "Teknik İmalat", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "Kalıphane", ust: "Teknik İmalat", tur: "Birim", onay: true },
  { ad: "CNC", ust: "Teknik İmalat", tur: "Birim", onay: true },
  { ad: "Tasarım", ust: "Teknik İmalat", tur: "Birim", onay: true },
  { ad: "Metal İmalat", ust: "Teknik İmalat", tur: "Birim", onay: true },
  { ad: "Üretim", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "Planlama", ust: "Genel Müdürlük", tur: "Departman", onay: true },
  { ad: "Montaj Kontrol", ust: "Genel Müdürlük", tur: "Departman", onay: true },
];

const KISILER: KisiTanimi[] = [
  {
    ad: "Yönetim Kurulu Üyesi",
    eposta: "yonetim.kurulu@ornek.test",
    unvan: "Yönetim Kurulu Üyesi",
    birim: "Yönetim Kurulu",
    yonetici: true,
    yazar: false,
    isScored: false,
    canAppreciate: true,
  },
  {
    ad: "Emre Aslan",
    eposta: "emre.aslan@ornek.test",
    unvan: "Genel Müdür",
    birim: "Genel Müdürlük",
    yonetici: true,
    yazar: false,
    isScored: false,
  },
  {
    ad: "Göktuğ Tezezer",
    eposta: "goktug.tezezer@ornek.test",
    unvan: "Genel Müdür Yardımcısı",
    birim: "Genel Müdürlük",
    yazar: false,
    isScored: false,
  },
  { ad: "Fehmi Erdoğan", eposta: "fehmi.erdogan@ornek.test", unvan: "Satın Alma ve İdari İşler Koordinatörü", birim: "Satın Alma ve İdari İşler Koordinatörlüğü", yonetici: true },
  { ad: "Merve Kaya", eposta: "merve.satinalma@ornek.test", unvan: "Satın Alma Müdürü", birim: "Satın Alma", yonetici: true },
  { ad: "Selim Demir", eposta: "selim.hukuk@ornek.test", unvan: "Hukuk Müdürü", birim: "Hukuk", yonetici: true },
  { ad: "Burcu Acar", eposta: "burcu.idari@ornek.test", unvan: "İdari İşler Müdürü", birim: "İdari İşler", yonetici: true },
  { ad: "Ahmet Çiftçi", eposta: "ahmet.ciftci@ornek.test", unvan: "Mali İşler Koordinatörü", birim: "Mali İşler Koordinatörlüğü", yonetici: true },
  { ad: "Barış Erdem", eposta: "baris.globalfinans@ornek.test", unvan: "Global Finans Müdürü", birim: "Global Finans", yonetici: true },
  { ad: "Nesrin Kılıç", eposta: "nesrin.muhasebe@ornek.test", unvan: "Muhasebe Müdürü", birim: "Muhasebe", yonetici: true },
  { ad: "Ufuk Yalçın", eposta: "ufuk.finans@ornek.test", unvan: "Finans Müdürü", birim: "Finans", yonetici: true },
  { ad: "Sevda Güneş", eposta: "sevda.denetim@ornek.test", unvan: "Denetim Müdürü", birim: "Denetim", yonetici: true },
  { ad: "Tolga Eren", eposta: "tolga.cari@ornek.test", unvan: "Cari Hesaplar Müdürü", birim: "Cari Hesaplar", yonetici: true },
  { ad: "İsmail Çehreli", eposta: "ismail.cehreli@ornek.test", unvan: "Lojistik Koordinatörü", birim: "Lojistik Koordinatörlüğü", yonetici: true },
  {
    ad: "Yasin Meral",
    eposta: "yasin.meral@ornek.test",
    unvan: "Bilgi İşlem Sorumlusu",
    birim: "Bilgi İşlem",
    yonetici: true,
    sistemYoneticisi: true,
  },
  { ad: "Tuna Kılıç", eposta: "tuna.dis.ticaret@ornek.test", unvan: "Dış Ticaret Müdürü", birim: "Dış Ticaret", yonetici: true },
  { ad: "Bora Öztürk", eposta: "bora.depo@ornek.test", unvan: "Depo ve Sevkiyat Müdürü", birim: "Depo ve Sevkiyat", yonetici: true },
  { ad: "Samet Arslan", eposta: "samet.arslan@ornek.test", unvan: "Satış, Pazarlama ve İş Geliştirme Müdürü", birim: "Satış, Pazarlama ve İş Geliştirme", yonetici: true },
  { ad: "Eda Yıldız", eposta: "eda.yildiz@ornek.test", unvan: "İnsan Kaynakları Müdürü", birim: "İnsan Kaynakları", yonetici: true },
  { ad: "Çağdaş Yancı", eposta: "cagdas.yanci@ornek.test", unvan: "Kalite Kontrol Müdürü", birim: "Kalite Kontrol", yonetici: true },
  { ad: "Mustafa Karakurt", eposta: "mustafa.karakurt@ornek.test", unvan: "Sosyal Uygunluk ve Çevre Müdürü", birim: "Sosyal Uygunluk ve Çevre", yonetici: true },
  { ad: "Volkan Şimşek", eposta: "volkan.simsek@ornek.test", unvan: "Teknik İmalat Müdürü", birim: "Teknik İmalat", yonetici: true },
  { ad: "Fatma Şahin", eposta: "fatma.kaliphane@ornek.test", unvan: "Kalıphane Müdürü", birim: "Kalıphane", yonetici: true },
  { ad: "Hakan Tunç", eposta: "hakan.cnc@ornek.test", unvan: "CNC Müdürü", birim: "CNC", yonetici: true },
  { ad: "Derya Yılmaz", eposta: "derya.tasarim@ornek.test", unvan: "Tasarım Müdürü", birim: "Tasarım", yonetici: true },
  { ad: "Kaan Şahin", eposta: "kaan.metal@ornek.test", unvan: "Metal İmalat Müdürü", birim: "Metal İmalat", yonetici: true },
  { ad: "Sami Arslan", eposta: "sami.arslan@ornek.test", unvan: "Üretim Müdürü", birim: "Üretim", yonetici: true },
  { ad: "Bayram Taştan", eposta: "bayram.tastan@ornek.test", unvan: "Planlama Müdürü", birim: "Planlama", yonetici: true },
  { ad: "Deniz Altunbezer", eposta: "deniz.altunbezer@ornek.test", unvan: "Montaj Kontrol Müdürü", birim: "Montaj Kontrol", yonetici: true },
  { ad: "Elif Aydın", eposta: "elif.satinalma@ornek.test", unvan: "Satın Alma Uzmanı", birim: "Satın Alma" },
  { ad: "Berk Yıldırım", eposta: "berk.muhasebe@ornek.test", unvan: "Muhasebe Uzmanı", birim: "Muhasebe" },
  { ad: "Selin Aksoy", eposta: "selin.dis.ticaret@ornek.test", unvan: "Dış Ticaret Uzmanı", birim: "Dış Ticaret" },
  { ad: "Yiğit Kaya", eposta: "yigit.kaliphane@ornek.test", unvan: "Kalıp Teknisyeni", birim: "Kalıphane" },
  { ad: "Hasan Demir", eposta: "hasan.planlamaci@ornek.test", unvan: "Üretim Planlama Uzmanı", birim: "Planlama" },
  { ad: "Cenk Yavuz", eposta: "cenk.uretim@ornek.test", unvan: "Üretim Operatörü", birim: "Üretim" },
  { ad: "Pelin Koç", eposta: "pelin.montaj@ornek.test", unvan: "Montaj Kontrol Uzmanı", birim: "Montaj Kontrol" },
  // Pasifleştirilecek kişi: geçmiş kayıtları durur, giriş yapamaz.
  { ad: "Mert Kaya", eposta: "mert.ayrilan@ornek.test", unvan: "Üretim Operatörü", birim: "Üretim" },
];

/** Kurulumun oluşturmayı beklediği birim adları; kök birim buna dahil değildir. */
export const DEMO_UNIT_NAMES = BIRIMLER.map((birim) => birim.ad);

const FAALIYETLER: Record<string, { baslik: string; aciklama: string }[]> = {
  "Satın Alma": [
    {
      baslik: "Teklif karşılaştırması",
      aciklama:
        "Üç tedarikçinin teklifleri karşılaştırıldı; teslim süresi ve toplam maliyet birlikte değerlendirildi.",
    },
    {
      baslik: "Sipariş takibi",
      aciklama:
        "Açık siparişlerin teslim tarihleri kontrol edildi; geciken iki sipariş için tedarikçiden güncel bilgi istendi.",
    },
  ],
  Kalıphane: [
    {
      baslik: "Kalıp bakımı",
      aciklama:
        "3 numaralı presteki kalıplar söküldü, yüzey aşınması ölçüldü ve temizlik yapıldı. İki kılavuz pimi değişti.",
    },
    {
      baslik: "Yeni kalıp denemesi",
      aciklama:
        "Müşteri numunesi için hazırlanan kalıpla ilk deneme basıldı; çapak sınırın üstünde, soğutma süresi artırılacak.",
    },
    {
      baslik: "Kalıp arıza takibi",
      aciklama:
        "Enjeksiyon hattında duran kalıbın sıcaklık sensörü değiştirildi. Hat 40 dakika durdu.",
    },
  ],
  Planlama: [
    {
      baslik: "Haftalık üretim planı",
      aciklama:
        "Gelen siparişlere göre haftalık plan güncellendi; iki iş emri öne alındı, hammadde teyidi bekleniyor.",
    },
    {
      baslik: "Tedarik gecikmesi",
      aciklama:
        "Yedek parça tedarikçisinden gelen bildirimle teslim tarihi bir hafta kaydı; alternatif tedarikçi araştırılıyor.",
    },
  ],
  Üretim: [
    {
      baslik: "Vardiya raporu",
      aciklama:
        "Sabah vardiyasında hedefin yüzde 92'si karşılandı; iki kısa duruş yaşandı, fire oranı normal aralıkta.",
    },
    {
      baslik: "Kalite kontrol sapması",
      aciklama:
        "Ölçü kontrolünde üç parçada tolerans dışı sapma görüldü; ilgili parti ayrıldı ve kalıphaneye bildirildi.",
    },
  ],
  "Depo ve Sevkiyat": [
    {
      baslik: "Sevkiyat planı",
      aciklama:
        "Günün sevkiyatları araç ve teslimat adreslerine göre sıralandı; iki müşteriye teslimat saati bildirildi.",
    },
    {
      baslik: "Depo sayımı",
      aciklama:
        "Hızlı dönen ürünlerin sayımı yapıldı; sistem kaydıyla fiziksel sayım arasındaki farklar düzeltildi.",
    },
  ],
  "Dış Ticaret": [
    {
      baslik: "Gümrük evrakı kontrolü",
      aciklama:
        "İhracat dosyasındaki fatura, çeki listesi ve menşe belgeleri kontrol edilerek eksik imza tamamlandı.",
    },
    {
      baslik: "Teslimat durumu",
      aciklama:
        "Yurt dışı sevkiyatların taşıyıcı bilgileri güncellendi; varış tarihleri ilgili ekiplere aktarıldı.",
    },
  ],
  Muhasebe: [
    {
      baslik: "Fatura kontrolü",
      aciklama:
        "Haftanın alış faturaları sipariş ve teslim kayıtlarıyla karşılaştırıldı; iki fatura açıklama için bekletildi.",
    },
    {
      baslik: "Mutabakat hazırlığı",
      aciklama:
        "Cari hesap bakiyeleri kontrol edildi ve ay sonu mutabakatı için eksik belgeler listelendi.",
    },
  ],
  "Teknik İmalat": [
    {
      baslik: "Üretim hattı hazırlığı",
      aciklama:
        "Günün üretim emri için kalıp, takım ve teknik çizim kontrol edildi; eksik malzeme planlamaya bildirildi.",
    },
    {
      baslik: "Teknik değerlendirme",
      aciklama:
        "Ölçü sapması görülen parça incelendi; takım ayarı ve tekrar kontrol adımları belirlendi.",
    },
  ],
  "Genel Müdürlük": [
    {
      baslik: "Aylık değerlendirme",
      aciklama:
        "Birimlerden gelen kısa durum bilgileri değerlendirildi; öncelikli iki konu için sorumlular ve takip tarihleri belirlendi.",
    },
  ],
};

/** Bugünden geriye doğru, çalışma günlerinden oluşan tarih listesi. */
function sonIsGunleri(now: Date, adet: number): string[] {
  const gunler: string[] = [];
  const imlec = new Date(`${companyDay(now)}T00:00:00.000Z`);

  while (gunler.length < adet) {
    const gun = imlec.toISOString().slice(0, 10);
    if (isBusinessDay(gun)) gunler.push(gun);
    imlec.setUTCDate(imlec.getUTCDate() - 1);
  }

  return gunler.reverse();
}


export async function installDemoData(
  db: PrismaClient,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const PAROLA = options.password ?? DEMO_DEFAULT_PASSWORD;
  const now = new Date();
  const satirlar: string[] = [];
  const log = (message: string) => {
    satirlar.push(message);
    options.onLog?.(message);
  };

  // Demo kullanıcı zaten varsa fakat birim köken kaydı yoksa bu, tablo
  // eklenmeden önce kurulmuş eski veridir. Böyle bir birimi adına bakıp
  // “önceden vardı” diye işaretlemek de, “demo oluşturdu” diye işaretlemek
  // de tahmindir. Kurulum eksikleri tamamlar fakat belirsizliği yöneticiye
  // bırakır (denetim 24.08.2026, P3-R6-2).
  const eskiDemoKurulumuVar =
    (await db.user.count({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    })) > 0;

  const root = await db.orgUnit.findFirst({ where: { parentId: null } });
  if (!root) {
    return { ok: false as const, error: "no_root" as const, log: satirlar };
  }

    // --- Birimler ---------------------------------------------------------
    const birimler = new Map<string, string>([["kök", root.id]]);

    for (const tanim of BIRIMLER) {
      const mevcut = await db.orgUnit.findFirst({ where: { name: tanim.ad } });
      if (mevcut) {
        birimler.set(tanim.ad, mevcut.id);
        if (!eskiDemoKurulumuVar) {
          await rememberDemoOrgUnitOrigin(db, mevcut.id, DEMO_ORIGIN_REUSED);
        }
        continue;
      }

      const ustId = birimler.get(tanim.ust);
      if (!ustId) throw new Error(`Üst birim bulunamadı: ${tanim.ust}`);

      const olusan = await createOrgUnit(db, {
        name: tanim.ad,
        type: tanim.tur,
        parentId: ustId,
        sortOrder: 0,
        // Yönetim kademelerinde faaliyet onayı yok; operasyon birimlerinde
        // çalışan kayıtları kendi yöneticilerinin onayına düşsün.
        requiresApproval: tanim.onay,
        autoFlowsUp: true,
        attentionGroupId: null,
      });

      if (!olusan.ok) throw new Error(`${tanim.ad}: ${olusan.message}`);
      birimler.set(tanim.ad, olusan.value.id);

      // **Köken kaydı** (denetim 23.08.2026, P3-R5-2). Ad bir köken
      // kaydı değildir: kurulum aynı adlı mevcut bir birimi yeniden
      // kullanıyor ve temizlik yalnız ada bakarsa **gerçek** bir birimi
      // silerdi. Silme kümesine yalnız burada yazılanlar giriyor.
      await rememberDemoOrgUnitOrigin(db, olusan.value.id, DEMO_ORIGIN_CREATED);

      log(`birim açıldı: ${tanim.ad}`);
    }

    // --- Kullanıcılar -----------------------------------------------------
    const kisiler = new Map<
      string,
      {
        id: string;
        orgUnitId: string;
        yoneticiId: string | null;
        /** Kaydın düşeceği bütün onaylayıcılar (§4.4, çoğul müdür). */
        yoneticiIds: string[];
      }
    >();

    for (const tanim of KISILER) {
      const mevcut = await db.user.findUnique({ where: { email: tanim.eposta } });
      if (mevcut) {
        kisiler.set(tanim.eposta, {
          id: mevcut.id,
          orgUnitId: mevcut.orgUnitId,
          yoneticiId: null,
          yoneticiIds: [],
        });
        continue;
      }

      const orgUnitId = birimler.get(tanim.birim);
      if (!orgUnitId) throw new Error(`Birim bulunamadı: ${tanim.birim}`);

      const sonuc = await createUser(db, {
        fullName: tanim.ad,
        email: tanim.eposta,
        orgUnitId,
        title: tanim.unvan ?? null,
        isUnitManager: tanim.yonetici ?? false,
        isSystemAdmin: tanim.sistemYoneticisi ?? false,
        writesActivities: tanim.yazar ?? true,
        isScored: tanim.isScored ?? true,
        canAppreciate: tanim.canAppreciate ?? false,
        initialPassword: PAROLA,
      });

      if (!sonuc.ok) throw new Error(`${tanim.eposta}: ${sonuc.message}`);
      kisiler.set(tanim.eposta, {
        id: sonuc.user.id,
        orgUnitId,
        yoneticiId: null,
        yoneticiIds: [],
      });
      log(`kullanıcı açıldı: ${tanim.ad}`);
    }

    // Profil ekranında örnek hesabın son başarılı giriş bilgisi de anlamlı
    // görünsün. Hesap gerçek biri tarafından kullanıldıysa zamanını
    // değiştirmeyiz; kurulum yalnız boş alanları doldurur.
    for (const [index, tanim] of KISILER.entries()) {
      const kisi = kisiler.get(tanim.eposta)!;
      await db.user.updateMany({
        where: { id: kisi.id, lastLoginAt: null },
        data: { lastLoginAt: new Date(now.getTime() - (index + 1) * 86_400_000) },
      });
    }

    // --- Onaylayıcılar ----------------------------------------------------
    // Onaya tabi birimde yazılan kayıt bir onaylayıcıya düşer; kim olduğu
    // ağaçtan çözülür. Örnek veri bunu elle uydurmaz, gerçek kuralı kullanır.
    for (const tanim of KISILER) {
      const kisi = kisiler.get(tanim.eposta)!;

      // Birim yöneticisi kendi biriminin onay bayrağına tabi değildir
      // (§4.3, §7.4): kaydı onaylayıcısız doğar. Örnek veri bunu yansıtmazsa
      // müdürün kayıtları üretimde oluşamayacak bir biçimde onaylayıcılı
      // görünür ve ekranlar yanlış bir akışı anlatır.
      if (tanim.yonetici) continue;

      const birim = await db.orgUnit.findUnique({
        where: { id: kisi.orgUnitId },
        select: { requiresApproval: true },
      });

      if (!birim?.requiresApproval) continue;

      // **Çoğul onaylayıcı** (20.08.2026 kararı): bir birimde birden fazla
      // müdür olabilir ve kayıt hepsinin kuyruğuna düşer. `resolveManager`
      // geriye uyumluluk için duruyor ve onay akışında kullanılmamalı
      // (denetim 23.08.2026, P3-R4-1).
      const yoneticiler = await resolveManagers(db, kisi.id);
      kisi.yoneticiIds = yoneticiler.found ? yoneticiler.managerIds : [];
      kisi.yoneticiId = yoneticiler.found ? (yoneticiler.managerIds[0] ?? null) : null;
    }

    /**
     * Üretim yolunun onay değişmezlerini kurar: uygun onaylayıcı listesi ve
     * onay turu (denetim 23.08.2026, P3-R3-3 ve P3-R4-1).
     *
     * **İdempotent**: eksik ilişki varsa tamamlar. "Eksik örnek veriyi
     * tamamla" düğmesi tam olarak bunu bekliyor; mevcut kaydı görüp
     * ilişkilerine bakmadan dönmek, yükseltme sonrası yarım kalmış veriyi
     * yarım bırakırdı.
     */
    async function onayIliskileriniKur(kayit: {
      id: string;
      approvalStatus: string;
      approverId: string | null;
      approvalSubmittedAt: Date | null;
      approvalDecidedAt: Date | null;
      onaylayiciIds: string[];
    }): Promise<void> {
      if (kayit.onaylayiciIds.length === 0) return;

      for (const userId of kayit.onaylayiciIds) {
        await db.activityApprover.upsert({
          where: { activityId_userId: { activityId: kayit.id, userId } },
          update: {},
          create: { activityId: kayit.id, userId },
        });
      }

      const gonderim = kayit.approvalSubmittedAt ?? kayit.approvalDecidedAt;
      if (!gonderim) return;

      const mevcutTur = await db.approvalRound.findFirst({
        where: { activityId: kayit.id },
        select: { id: true },
      });
      if (mevcutTur) return;

      const kararliMi =
        kayit.approvalStatus !== "PENDING_APPROVAL" && kayit.approvalDecidedAt !== null;

      await db.approvalRound.create({
        data: {
          activityId: kayit.id,
          roundNo: 1,
          submittedAt: gonderim,
          ...(kararliMi
            ? {
                decidedAt: kayit.approvalDecidedAt,
                decidedById: kayit.approverId,
                decision:
                  kayit.approvalStatus === "APPROVED"
                    ? ("APPROVED" as const)
                    : kayit.approvalStatus === "REJECTED"
                      ? ("REJECTED" as const)
                      : ("CHANGES_REQUESTED" as const),
              }
            : {}),
        },
      });
    }

    // --- Faaliyetler ------------------------------------------------------
    const gunler = sonIsGunleri(now, GUN_SAYISI);
    let yazilan = 0;

    for (const tanim of KISILER) {
      // Faaliyet yazması beklenmeyen kişiye örnek kayıt da yazılmaz: yönetim
      // kurulu üyesinin günlük faaliyet defteri olmaz.
      if (tanim.yazar === false) continue;

      const kisi = kisiler.get(tanim.eposta)!;
      const havuz = FAALIYETLER[tanim.birim] ?? FAALIYETLER["Genel Müdürlük"];

      for (const [index, gun] of gunler.entries()) {
        // Herkes her gün yazmaz: "bugün faaliyet yok" hatırlatması da görünsün.
        if ((index + tanim.eposta.length) % 4 === 0) continue;

        const sablon = havuz[index % havuz.length];
        const baslik = `${sablon.baslik} — ${gun.slice(5)}`;

        const mevcut = await activityMaintenanceReader(db).findFirst({
          where: { authorId: kisi.id, title: baslik },
          select: {
            id: true,
            approvalStatus: true,
            approverId: true,
            approvalSubmittedAt: true,
            approvalDecidedAt: true,
          },
        });
        if (mevcut) {
          // Eksik ilişkiyi tamamla: yükseltmeden önce kurulmuş örnek veride
          // onay turu ve onaylayıcı listesi yok.
          await onayIliskileriniKur({ ...mevcut, onaylayiciIds: kisi.yoneticiIds });
          continue;
        }

        const olusturuldu = new Date(`${gun}T14:00:00.000Z`);
        const kayit = await db.activity.create({
          data: {
            authorId: kisi.id,
            authorOrgUnitId: kisi.orgUnitId,
            activityDate: toDateValue(gun),
            title: baslik,
            description: sablon.aciklama,
            approvalStatus: "APPROVED",
            approverId: kisi.yoneticiId,
            approvalSubmittedAt: kisi.yoneticiId ? olusturuldu : null,
            approvalDecidedAt: kisi.yoneticiId ? olusturuldu : null,
            createdAt: olusturuldu,
            updatedAt: olusturuldu,
          },
        });
        await onayIliskileriniKur({
          id: kayit.id,
          approvalStatus: kayit.approvalStatus,
          approverId: kayit.approverId,
          approvalSubmittedAt: kayit.approvalSubmittedAt,
          approvalDecidedAt: kayit.approvalDecidedAt,
          onaylayiciIds: kisi.yoneticiIds,
        });

        // Her kaydın bir revizyonu olur: detay ekranındaki "sürüm 1" ve
        // düzeltme geçmişi buradan okunur.
        await db.activityRevision.create({
          data: {
            activityId: kayit.id,
            revisionNo: 1,
            title: baslik,
            description: sablon.aciklama,
            targetOrgUnitIds: [],
            changedById: kisi.id,
            createdAt: olusturuldu,
          },
        });
        yazilan += 1;
      }
    }

    if (yazilan > 0) log(`${yazilan} faaliyet yazıldı`);

    // --- Muhatap departmanlar --------------------------------------------
    // Kalıphane kayıtlarının bir kısmı Üretim'i muhatap gösterir (§8.3).
    const kalipMudur = kisiler.get("fatma.kaliphane@ornek.test")!;
    const uretimId = birimler.get("Üretim")!;
    const kalipKayitlari = await activityMaintenanceReader(db).findMany({
      where: { authorId: kalipMudur.id },
      select: { id: true },
      take: 3,
    });

    for (const kayit of kalipKayitlari) {
      await db.activityTargetDept.createMany({
        data: [{ activityId: kayit.id, orgUnitId: uretimId }],
        skipDuplicates: true,
      });
    }

    // --- Konuşmalar -------------------------------------------------------
    // Gerçek servisten geçer: görünürlük ve sorumluluk kuralları burada da
    // aynen işlesin.
    const genelMudur = kisiler.get("emre.aslan@ornek.test")!;
    const mevcutKonusma = await db.conversation.count();

    if (mevcutKonusma === 0 && kalipKayitlari.length >= 2) {
      const acik = await askQuestion(
        db,
        { id: genelMudur.id, isSystemAdmin: false },
        {
          activityId: kalipKayitlari[0].id,
          text: "Bu kalıptaki aşınma tekrar ediyor; kalıcı bir çözüm için ne öneriyorsun?",
        },
        now,
      );
      if (acik.ok) log("açık konuşma eklendi (cevap bekliyor)");

      const cevaplanan = await askQuestion(
        db,
        { id: genelMudur.id, isSystemAdmin: false },
        {
          activityId: kalipKayitlari[1].id,
          text: "Çapak sorununda hangi parametreyi değiştirdiniz?",
        },
        now,
      );

      if (cevaplanan.ok) {
        await replyToConversation(
          db,
          { id: kalipMudur.id, isSystemAdmin: false },
          {
            conversationId: cevaplanan.value.id,
            text: "Soğutma süresini iki saniye uzattık; sonraki denemede ölçüp bildireceğim.",
          },
          new Date(now.getTime() + 3_600_000),
        );
        log("cevaplanmış konuşma eklendi");
      }
    }

    // --- İptal edilmiş bir kayıt -----------------------------------------
    const planlamaci = kisiler.get("hasan.planlamaci@ornek.test")!;
    const iptalEdilecek = await activityMaintenanceReader(db).findFirst({
      where: { authorId: planlamaci.id, approvalStatus: "APPROVED" },
      select: { id: true },
    });

    if (iptalEdilecek) {
      const zatenIptal = await db.cancellationRecord.count({
        where: { activityId: iptalEdilecek.id },
      });

      if (zatenIptal === 0) {
        await db.$transaction(async (tx) => {
          await tx.activity.update({
            where: { id: iptalEdilecek.id },
            data: { approvalStatus: "CANCELLED" },
          });
          await tx.cancellationRecord.create({
            data: {
              activityId: iptalEdilecek.id,
              cancelledById: planlamaci.id,
              reason: "Yanlış güne girilmiş, doğrusu ayrıca yazıldı.",
              createdAt: now,
            },
          });
        });
        log("iptal edilmiş bir kayıt eklendi");
      }
    }

    // --- Onay gerekçeleri -------------------------------------------------
    // Sistem yöneticisi tanımlar; müdür karar verirken listeden seçer.
    // Serbest metin raporlanamaz: herkes kendi cümlesini yazarsa "neden
    // düzeltme istendi" sorusunun cevabı sayılamaz.
    const GEREKCELER = [
      { kind: "CHANGES_REQUESTED" as const, label: "Açıklama yetersiz", sortOrder: 1 },
      { kind: "CHANGES_REQUESTED" as const, label: "Yanlış güne yazılmış", sortOrder: 2 },
      { kind: "CHANGES_REQUESTED" as const, label: "İlgili departman eksik", sortOrder: 3 },
      { kind: "REJECTED" as const, label: "Faaliyet kapsamı dışında", sortOrder: 1 },
      { kind: "REJECTED" as const, label: "Mükerrer kayıt", sortOrder: 2 },
    ];

    for (const gerekce of GEREKCELER) {
      await db.approvalReason.upsert({
        where: { kind_label: { kind: gerekce.kind, label: gerekce.label } },
        update: {},
        create: gerekce,
      });
    }

    const duzeltmeGerekce = await db.approvalReason.findFirst({
      where: { kind: "CHANGES_REQUESTED", label: "Açıklama yetersiz" },
    });
    const retGerekce = await db.approvalReason.findFirst({
      where: { kind: "REJECTED", label: "Mükerrer kayıt" },
    });

    // --- Karar bekleyen ve karara bağlanmış kayıtlar ----------------------
    // Onay akışının dört hâli de ekranda görünsün: bekleyen, düzeltme
    // istenen, reddedilen ve onaylanan.
    const kalipci = kisiler.get("yigit.kaliphane@ornek.test")!;
    const planci = kisiler.get("hasan.planlamaci@ornek.test")!;
    const bugun = companyDay(now);

    async function kararliKayit(
      yazar: {
        id: string;
        orgUnitId: string;
        yoneticiId: string | null;
        yoneticiIds: string[];
      },
      baslik: string,
      aciklama: string,
      durum: "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "REJECTED",
      gerekceId: string | null,
      gerekceKind: "CHANGES_REQUESTED" | "REJECTED" | null,
      not: string | null,
    ): Promise<string | null> {
      const mevcut = await activityMaintenanceReader(db).findFirst({
        where: { authorId: yazar.id, title: baslik },
        select: {
          id: true,
          approvalStatus: true,
          approverId: true,
          approvalSubmittedAt: true,
          approvalDecidedAt: true,
        },
      });
      if (mevcut) {
        await onayIliskileriniKur({ ...mevcut, onaylayiciIds: yazar.yoneticiIds });
        return mevcut.id;
      }
      if (!yazar.yoneticiId) return null;

      const kayit = await db.activity.create({
        data: {
          authorId: yazar.id,
          authorOrgUnitId: yazar.orgUnitId,
          activityDate: toDateValue(bugun),
          title: baslik,
          description: aciklama,
          approvalStatus: durum,
          approverId: yazar.yoneticiId,
          approvalSubmittedAt: now,
          approvalDecidedAt: durum === "PENDING_APPROVAL" ? null : now,
          approvalReasonId: gerekceId,
          approvalReasonKind: gerekceKind,
          approvalReasonNote: not,
        },
      });

      await db.activityRevision.create({
        data: {
          activityId: kayit.id,
          revisionNo: 1,
          title: baslik,
          description: aciklama,
          targetOrgUnitIds: [],
          changedById: yazar.id,
        },
      });

      // **Üretim yolunun değişmezleri örnek veride de kurulur**
      // (denetim 23.08.2026, P3-R3-3 ve P3-R4-1): bütün onaylayıcılar ve
      // duruma uygun onay turu.
      await onayIliskileriniKur({
        id: kayit.id,
        approvalStatus: durum,
        approverId: yazar.yoneticiId,
        approvalSubmittedAt: now,
        approvalDecidedAt: durum === "PENDING_APPROVAL" ? null : now,
        onaylayiciIds: yazar.yoneticiIds,
      });

      return kayit.id;
    }

    await kararliKayit(
      kalipci,
      "Pres hattı günlük kontrol",
      "Üç preste günlük yağ ve basınç kontrolü yapıldı; ikisinde değer normal, birinde basınç düşük çıktı.",
      "PENDING_APPROVAL",
      null,
      null,
      null,
    );
    await kararliKayit(
      planci,
      "Sipariş önceliklendirme",
      "Gelen üç acil sipariş plana alındı.",
      "CHANGES_REQUESTED",
      duzeltmeGerekce?.id ?? null,
      duzeltmeGerekce ? "CHANGES_REQUESTED" : null,
      "Hangi siparişlerin öne alındığı ve hangilerinin kaydığı yazılmamış.",
    );
    await kararliKayit(
      planci,
      "Sipariş önceliklendirme (tekrar)",
      "Aynı konu ikinci kez girildi.",
      "REJECTED",
      retGerekce?.id ?? null,
      retGerekce ? "REJECTED" : null,
      "Aynı gün için aynı içerik zaten kayıtlı.",
    );
    log("onay akışının dört hâli için kayıt eklendi");

    // --- Takip maddeleri --------------------------------------------------
    // Üç hâl: yeni açılmış, uzun süredir hareketsiz ve kapatılmış.
    const genelMudurViewer = { id: genelMudur.id, isSystemAdmin: false };
    const takipVar = await db.followUpItem.count();

    if (takipVar === 0) {
    const adaylar = await activityMaintenanceReader(db).findMany({
        where: { approvalStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true },
      });

      if (adaylar.length >= 3) {
        const taze = await openFollowUp(db, genelMudurViewer, {
          activityId: adaylar[0].id,
          nextStep: "Tedarikçiden yazılı teyit alınacak.",
        }, now);
        if (taze.ok) log("açık takip maddesi eklendi");

        // Sahibi devredilmiş madde: sahip, kaydı **görebilen** biri olmalı.
        // Bu yüzden kalıphane müdürüne devredilecek madde, kalıphaneden bir
        // kayıt üzerinde açılır — kural örnek veride de aynen işler.
      const kalipKaydi = await activityMaintenanceReader(db).findFirst({
          where: { authorId: kalipci.id, approvalStatus: "APPROVED" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        const eski = kalipKaydi
          ? await openFollowUp(db, genelMudurViewer, {
              activityId: kalipKaydi.id,
              nextStep: "Kalıcı çözüm için teknik değerlendirme yapılacak.",
              ownerId: kalipMudur.id,
            }, now)
          : ({ ok: false } as const);

        if (eski.ok) {
          // Hareketsizlik eşiğini aşsın: son hareket 20 gün öncesine çekilir.
          const geriye = new Date(now.getTime() - 20 * 24 * 3_600_000);
          await db.followUpItem.update({
            where: { id: eski.item.id },
            data: { openedAt: geriye, lastMovedAt: geriye, createdAt: geriye },
          });
          log("uzun süredir hareketsiz takip maddesi eklendi");
        }

        const kapanacak = await openFollowUp(db, genelMudurViewer, {
          activityId: adaylar[2].id,
          nextStep: "Yedek parça siparişi verilecek.",
        }, now);

        if (kapanacak.ok) {
          await closeFollowUp(
            db,
            genelMudurViewer,
            kapanacak.item.id,
            "Parça geldi ve takıldı; konu kapandı.",
            now,
          );
          log("kapatılmış takip maddesi eklendi");
        }
      }
    }

    // --- Okundu bilgisi ---------------------------------------------------
    // Bir kısmı okunmuş, bir kısmı okunmamış olsun: kapsam akışındaki
    // okunmamış işareti ve rozet ancak böyle anlam taşır.
    const okunanlar = await activityMaintenanceReader(db).findMany({
      where: { authorId: { not: genelMudur.id }, approvalStatus: "APPROVED" },
      orderBy: { createdAt: "desc" },
      skip: 4,
      take: 10,
      select: { id: true },
    });

    for (const kayit of okunanlar) {
      await db.readReceipt.upsert({
        where: { activityId_userId: { activityId: kayit.id, userId: genelMudur.id } },
        update: {},
        create: {
          activityId: kayit.id,
          userId: genelMudur.id,
          firstReadAt: now,
          lastReadAt: now,
        },
      });
    }
    log(`${okunanlar.length} kayıt genel müdür için okundu işaretlendi`);

    // --- Çalışma takvimi: resmî tatiller ----------------------------------
    const yil = Number(bugun.slice(0, 4));
    const TATILLER = [
      { tarih: `${yil}-01-01`, ad: "Yılbaşı" },
      { tarih: `${yil}-04-23`, ad: "Ulusal Egemenlik ve Çocuk Bayramı" },
      { tarih: `${yil}-05-01`, ad: "Emek ve Dayanışma Günü" },
      { tarih: `${yil}-05-19`, ad: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
      { tarih: `${yil}-08-30`, ad: "Zafer Bayramı" },
      { tarih: `${yil}-10-29`, ad: "Cumhuriyet Bayramı" },
    ];

    for (const tatil of TATILLER) {
      await db.holiday.upsert({
        where: { date: toDateValue(tatil.tarih) },
        update: {},
        create: { date: toDateValue(tatil.tarih), description: tatil.ad },
      });
    }
    log(`${TATILLER.length} resmî tatil takvime yazıldı`);

    // --- Yardım ve sık sorulanlar -----------------------------------------
    // Genel müdür örnek sisteme girdiğinde yalnızca dolu ekran değil, bu
    // ekranların ne işe yaradığını anlatan kısa bir başvuru kaynağı da görsün.
    // Başlık + bölüm üzerinden idempotent çalışır; yöneticinin sonradan
    // düzenlediği yazının üzerine yazılmaz.
    const YARDIM_YAZILARI = [
      {
        category: "Başlangıç",
        title: "İlk kez giriş yaptığımda ne yapmalıyım?",
        answer:
          "Önce Bugün ekranına bakın. Burada size düşen işleri, bekleyen onayları ve gün içindeki kısa özeti görürsünüz. Yeni bir kayıt girmek için Faaliyetlerim bölümünden Yeni faaliyet düğmesine basın.\n\nProfilim bölümünden bildirim tercihinizi ve gerekiyorsa profil fotoğrafınızı güncelleyebilirsiniz.",
      },
      {
        category: "Faaliyetler",
        title: "Faaliyet kaydı nasıl girilir?",
        answer:
          "Faaliyetlerim bölümünü açın, Yeni faaliyet düğmesine basın ve başlıkla açıklamayı doldurun. Başkalarının da anlayabilmesi için başlığı kısa, açıklamayı yeterince ayrıntılı yazın.\n\nKaydınız onay gerektiriyorsa yöneticinizin ekranına düşer. Onaylanana kadar kaydı kendi arşivinizde görmeye devam edersiniz.",
      },
      {
        category: "İzinlerim",
        title: "Faaliyet beklenmeyen gün ne işe yarar?",
        answer:
          "İzinli, raporlu veya başka bir nedenle faaliyet giremeyeceğiniz günleri İzinlerim bölümüne yazabilirsiniz. Bu günler onaylandıktan sonra o tarihler için faaliyet hatırlatması gönderilmez ve katılım hesabında beklenen günlerden düşülür.\n\nÇalışanların kendi talepleri yöneticinin onayından sonra geçerli olur. Birim yöneticisinin kendi kaydı doğrudan geçerlidir.",
      },
      {
        category: "Yöneticiler",
        title: "Bir çalışan gün talebi gönderirse ne yapmalıyım?",
        answer:
          "Ekip bölümünü açın. Yalnız yöneticisi olduğunuz departmandaki çalışanların kayıtlarını görürsünüz. Onay bekleyen talebin tarih ve notunu kontrol edip Onayla veya Reddet düğmesini kullanın.\n\nReddetme kararında çalışan neyi düzeltmesi gerektiğini anlayabilsin diye kısa bir gerekçe yazın. Başka departmanların kayıtları bu ekranda görünmez.",
      },
      {
        category: "Bildirimler",
        title: "Çok fazla bildirim gelirse ne yapabilirim?",
        answer:
          "Sistem yöneticisi Bildirimler ayarından olayları ve kanalları açıp kapatabilir. Siz de Profilim bölümünden e-posta bildirimlerini anlık, günlük özet veya yalnızca işlem gerekenler şeklinde seçebilirsiniz.\n\nParola belirleme ve hesap açılışı gibi güvenlik e-postaları her zaman gönderilir.",
      },
    ] as const;

    let eklenenYardim = 0;
    for (const [index, yazi] of YARDIM_YAZILARI.entries()) {
      const mevcut = await db.helpArticle.findFirst({
        where: {
          category: yazi.category,
          title: yazi.title,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (mevcut) continue;

      const sonuc = await createHelpArticle(db, genelMudur.id, {
        ...yazi,
        sortOrder: index,
        isPublished: true,
      }, now);
      if (!sonuc.ok) throw new Error(`${yazi.title}: ${sonuc.message}`);
      eklenenYardim += 1;
    }
    if (eklenenYardim > 0) log(`${eklenenYardim} yardım yazısı eklendi`);

    // --- İzin işaretleri --------------------------------------------------
    // "Bugün yazmadı" listesinde izinli kişinin eksik görünmemesi için.
    const izinVar = await db.noActivityPeriod.count();
    if (izinVar === 0) {
      const izinli = kisiler.get("pelin.montaj@ornek.test");
      const montajMudur = kisiler.get("deniz.altunbezer@ornek.test");

      if (izinli && montajMudur) {
        const baslangic = new Date(now.getTime() - 2 * 24 * 3_600_000);
        const bitis = new Date(now.getTime() + 3 * 24 * 3_600_000);

        await db.noActivityPeriod.create({
          data: {
            userId: izinli.id,
            startDate: toDateValue(companyDay(baslangic)),
            endDate: toDateValue(companyDay(bitis)),
            note: "Yıllık izin",
            markedById: montajMudur.id,
            status: "APPROVED",
            decidedAt: now,
            decidedById: montajMudur.id,
          },
        });
        log("izin kaydı eklendi");
      }

    }

    // Genel müdürün ve bölüm müdürlerinin ekranı ilk açıldığında üç durum da
    // anlaşılır olsun: doğrudan girilmiş onaylı kayıt, onay bekleyen talep ve
    // gerekçesiyle reddedilmiş talep. Kayıtlar notlarına göre bulunur; kurulum
    // ikinci kez çalıştırıldığında mevcut kayıtların kararını değiştirmeyiz.
    const nazli = kisiler.get("yonetim.kurulu@ornek.test");
    const kalipciCalisan = kisiler.get("yigit.kaliphane@ornek.test");

    if (nazli) {
      const not = "Örnek: yönetici tarafından onaylandı";
      const mevcut = await db.noActivityPeriod.findFirst({
        where: { userId: nazli.id, note: not },
        select: { id: true },
      });
      if (!mevcut) {
        const baslangic = companyDay(new Date(now.getTime() + 6 * 86_400_000));
        const bitis = companyDay(new Date(now.getTime() + 8 * 86_400_000));
        const sonuc = await markOwnNoActivityPeriod(
          db,
          nazli.id,
          {
            startDate: baslangic,
            endDate: bitis,
            note: not,
          },
          now,
        );
        if (!sonuc.ok) throw new Error(`Yönetim Kurulu örnek izni: ${sonuc.message}`);
        log("Yönetim Kurulu üyesi için onaylı izin örneği eklendi");
      }
    }

    // Yönetim Kurulu üyesi, görünür bir onaylı faaliyete örnek takdir versin.
    // Aynı kayıt ikinci kurulumda yeniden yazılmaz; ayar kapalı olsa bile
    // örnek hazır durur ve özellik açıldığında ekranda anlaşılır bir örnek
    // görünür.
    if (nazli && kalipKayitlari.length > 0) {
      const takdir = await db.activityAppreciation.findUnique({
        where: {
          activityId_userId: {
            activityId: kalipKayitlari[0].id,
            userId: nazli.id,
          },
        },
        select: { activityId: true },
      });

      if (!takdir) {
        await db.activityAppreciation.create({
          data: {
            activityId: kalipKayitlari[0].id,
            userId: nazli.id,
            createdAt: now,
          },
        });
        log("Yönetim Kurulu tarafından örnek takdir eklendi");
      }
    }

    if (kalipciCalisan && kalipMudur) {
      const bekleyenNot = "Örnek: yönetici onayı bekleniyor";
      const bekleyen = await db.noActivityPeriod.findFirst({
        where: { userId: kalipciCalisan.id, note: bekleyenNot },
        select: { id: true },
      });
      if (!bekleyen) {
        const baslangic = companyDay(new Date(now.getTime() + 10 * 86_400_000));
        const bitis = companyDay(new Date(now.getTime() + 11 * 86_400_000));
        const sonuc = await markOwnNoActivityPeriod(
          db,
          kalipciCalisan.id,
          { startDate: baslangic, endDate: bitis, note: bekleyenNot },
          now,
        );
        if (!sonuc.ok) throw new Error(`Bekleyen izin örneği: ${sonuc.message}`);
        log("onay bekleyen izin talebi eklendi");
      }

      const reddedilenNot = "Örnek: reddedilmiş izin talebi";
      let reddedilen = await db.noActivityPeriod.findFirst({
        where: { userId: kalipciCalisan.id, note: reddedilenNot },
        select: { id: true, status: true },
      });
      if (!reddedilen) {
        const baslangic = companyDay(new Date(now.getTime() + 14 * 86_400_000));
        const bitis = companyDay(new Date(now.getTime() + 15 * 86_400_000));
        const sonuc = await markOwnNoActivityPeriod(
          db,
          kalipciCalisan.id,
          { startDate: baslangic, endDate: bitis, note: reddedilenNot },
          now,
        );
        if (!sonuc.ok) throw new Error(`Reddedilecek izin örneği: ${sonuc.message}`);
        reddedilen = { id: sonuc.id, status: sonuc.status };
      }
      if (reddedilen.status === "PENDING") {
        const sonuc = await decideNoActivityPeriod(
          db,
          kalipMudur.id,
          reddedilen.id,
          "REJECTED",
          "Bu örnek talep için tarihlerin yeniden kontrol edilmesi gerekiyor.",
          now,
        );
        if (!sonuc.ok) throw new Error(`Reddedilmiş izin örneği: ${sonuc.message}`);
        log("reddedilmiş izin talebi eklendi");
      }
    }

    // --- Vekâlet örneği ---------------------------------------------------
    // Teknik İmalat müdürü izinde, yerine Kalıphane müdürü bakıyor. Vekâlet
    // **yalnız yönetici düzeyinde** olduğu için iki taraf da birim yöneticisi.
    //
    // Kendi koşulu var: izin kaydı zaten varsa bile vekâlet örneği kurulmalı,
    // yoksa ekran boş kalır ve özellik denenemez.
    const vekaletVar = await db.noActivityPeriod.count({
      where: { deputyId: { not: null } },
    });

    if (vekaletVar === 0) {
      const teknikMudurVekaleti = kisiler.get("volkan.simsek@ornek.test");
      const vekil = kisiler.get("fatma.kaliphane@ornek.test");
      const genelMudurVekalet = kisiler.get("emre.aslan@ornek.test");

      if (teknikMudurVekaleti && vekil && genelMudurVekalet) {
        const vBas = new Date(now.getTime() - 1 * 24 * 3_600_000);
        const vBit = new Date(now.getTime() + 4 * 24 * 3_600_000);

        await db.noActivityPeriod.create({
          data: {
            userId: teknikMudurVekaleti.id,
            startDate: toDateValue(companyDay(vBas)),
            endDate: toDateValue(companyDay(vBit)),
            note: "Yıllık izin — yerine Kalıphane Müdürü bakıyor",
            deputyId: vekil.id,
            markedById: genelMudurVekalet.id,
          },
        });
        log("vekâlet örneği eklendi (Teknik İmalat → Kalıphane Müdürü)");
      }
    }

    // --- Pasif kullanıcı --------------------------------------------------
    // Hesap silinmez, pasifleştirilir: geçmiş kayıtları yerinde kalır.
    const ayrilan = kisiler.get("mert.ayrilan@ornek.test");
    if (ayrilan) {
      await db.user.update({
        where: { id: ayrilan.id },
        data: { isActive: false },
      });
    }

    // --- Bildirimler ------------------------------------------------------
    // Zil kutusunun boş olduğu bir sistemde bildirim ekranı çalıştığını
    // göstermez. Kuyruğa gerçek olay satırları yazılır; bir kısmı görülmüş,
    // bir kısmı görülmemiş olsun ki rozet de anlam taşısın.
    // Yalnız **bu betiğin yazdığı** satırlara bakılır. Örnek kullanıcıların
    // kuyruğunda zaten satır var: soru sorma servisi kendi bildirimini
    // yazıyor. Onlara bakmak, örnek bildirimlerin hiç kurulmamasına yol
    // açıyordu.
    const bildirimVar = await db.notificationQueue.count({
      where: { idempotencyKey: { startsWith: "ornek-veri:" } },
    });

    if (bildirimVar === 0) {
      const ornekKayitlar = await activityMaintenanceReader(db).findMany({
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { id: true, title: true, authorId: true },
      });

      const bildirimler: {
        userId: string;
        eventType: string;
        activity: { id: string; title: string };
        gorulmus: boolean;
        dakikaOnce: number;
      }[] = [];

      if (ornekKayitlar.length >= 3) {
        bildirimler.push(
          {
            userId: kalipMudur.id,
            eventType: NOTIFICATION_EVENTS.approvalPending,
            activity: ornekKayitlar[0],
            gorulmus: false,
            dakikaOnce: 12,
          },
          {
            userId: kalipMudur.id,
            eventType: NOTIFICATION_EVENTS.questionAsked,
            activity: ornekKayitlar[1],
            gorulmus: false,
            dakikaOnce: 95,
          },
          {
            userId: genelMudur.id,
            eventType: NOTIFICATION_EVENTS.answerReceived,
            activity: ornekKayitlar[1],
            gorulmus: true,
            dakikaOnce: 260,
          },
          {
            userId: planci.id,
            eventType: NOTIFICATION_EVENTS.changesRequested,
            activity: ornekKayitlar[2],
            gorulmus: false,
            dakikaOnce: 40,
          },
          {
            userId: kalipci.id,
            eventType: NOTIFICATION_EVENTS.activityApproved,
            activity: ornekKayitlar[2],
            gorulmus: true,
            dakikaOnce: 1500,
          },
        );
      }

      for (const [sira, bildirim] of bildirimler.entries()) {
        const olusma = new Date(now.getTime() - bildirim.dakikaOnce * 60_000);

        await db.notificationQueue.create({
          data: {
            userId: bildirim.userId,
            eventType: bildirim.eventType,
            channel: "EMAIL",
            payload: {
              activityId: bildirim.activity.id,
              activityTitle: bildirim.activity.title,
            },
            idempotencyKey: `ornek-veri:${bildirim.eventType}:${sira}`,
            // Örnek veride SMTP yok; satır "gönderildi" sayılır ki kuyruk
            // ekranı bekleyen iş yığını gibi görünmesin.
            status: "SENT",
            sentAt: olusma,
            seenAt: bildirim.gorulmus ? olusma : null,
            createdAt: olusma,
          },
        });
      }

      if (bildirimler.length > 0) log(`${bildirimler.length} bildirim eklendi`);
    }


    log("hazır.");
    return { ok: true as const, log: satirlar };
}
