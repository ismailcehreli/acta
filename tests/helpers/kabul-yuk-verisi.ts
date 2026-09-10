/**
 * Kabul koşusu için 12 aylık yük verisi (Görev 6.3).
 *
 * Sayfa sürelerini ölçmek gerçekçi bir veri hacmi gerektiriyor: on kayıtlık
 * bir veritabanında her sayfa hızlıdır ve ölçüm hiçbir şey söylemez.
 *
 * **Ölçülen her yüzey için veri üretir** (denetim 23.08.2026,
 * bulgu 10). Önceki hâli yalnız 40 kullanıcı ve varsayılan durumu `APPROVED`
 * olan faaliyet yazıyordu; buna rağmen bekleyen onay, takip maddesi, taslak,
 * izin, denetim izi, bildirim ve skor dönemi tablolarını okuyan sayfaların
 * süreleri kabul sonucu sayılıyordu. `/approvals`, `/follow-ups`, `/drafts`,
 * `/team/absence`, `/admin/audit` ve `/scores` **boş ekran** ölçüyordu; skor
 * ayarı da kapalıydı, yani `/scores` hiç hesap yapmıyordu.
 *
 * **Kapsam kökten ölçülür.** Yük kullanıcıları kök dâhil bütün aktif
 * birimlere dağılıyor; Genel Müdür kökte olmadığı için kökteki kişilerin
 * kayıtlarını görmüyordu ve "en geniş kapsam" iddiası yanlıştı. Ölçüm artık
 * kökteki YK Başkanı ile yapılıyor (bkz. `e2e/kabul-olcum.spec.ts`).
 *
 * **Gerçek servisler kullanılır.** Bekleyen onay, takip maddesi, taslak,
 * izin ve skor dönemi satırları elle kurulmuyor; üretimde yazan servislerin
 * kendisi çağrılıyor. Elle kurulan satır üretimde imkânsız bir dünya
 * yaratabilir ve ölçüm yanlış şeyi ölçer — bu tuzağa bir kez düşüldü
 * (P3-R2-1). Yalnız **toplu geçmiş** doğrudan yazılıyor; sebebi ve şeklinin
 * servis çıktısıyla aynı olduğunun kanıtı `onayliGecmisSatiri` yorumunda.
 *
 * **Yalnız test veritabanına yazar.** Hedef `assertTestDatabaseUrl` ile
 * doğrulanır: uygulama veritabanına on bin sahte kayıt yazmak, gerçek veriyi
 * geri döndürülemez biçimde kirletirdi.
 */
import { PrismaClient } from "@prisma/client";

import { assertTestDatabaseUrl } from "./assert-test-database";
import { hashPassword } from "@/server/auth/password";
import { saveDraft } from "@/server/activities/drafts";
import { createActivity } from "@/server/activities/write";
import { markNoActivityPeriod } from "@/server/absence/service";
import { openFollowUp, closeFollowUp } from "@/server/follow-ups/service";
import { closeScorePeriod } from "@/server/scoring/close-period";
import { SETTING_KEYS } from "@/server/settings/registry";
import { saveSettings } from "@/server/settings/system-settings";

/** Şirket büyüklüğü: ister belgesi 30–40 kişi diyor, üst sınırdan ölçülüyor. */
export const HEDEF_AKTIF_KISI_SAYISI = 40;
const AY_SAYISI = 12;

/**
 * Global E2E kurulumu da şirketin parçasıdır; yük kişileri onun **üstüne**
 * sabit 40 kişi olarak eklenmez. Hedef aşılmışsa başka bir hacmi 40 diye
 * raporlamak yerine ölçüm başlamadan durulur.
 */
export function eksikYukKisiSayisi(mevcutAktifKisiSayisi: number): number {
  if (
    !Number.isInteger(mevcutAktifKisiSayisi) ||
    mevcutAktifKisiSayisi < 0
  ) {
    throw new Error(`Aktif kişi sayısı geçersiz: ${mevcutAktifKisiSayisi}`);
  }

  if (mevcutAktifKisiSayisi > HEDEF_AKTIF_KISI_SAYISI) {
    throw new Error(
      `Mevcut aktif kişi sayısı (${mevcutAktifKisiSayisi}) hedef ` +
        `${HEDEF_AKTIF_KISI_SAYISI} sayısını aşıyor.`,
    );
  }

  return HEDEF_AKTIF_KISI_SAYISI - mevcutAktifKisiSayisi;
}

/**
 * Onay kuyruğunda **bekleyen** kaç iş günü olsun.
 *
 * Bütün geçmişi bekleyen bırakmak gerçek dışı olurdu: onaya tabi bir birimde
 * kararlar birkaç gün içinde veriliyor ve on iki aylık bir kuyruk hiçbir
 * şirkette yok. Ölçülen şey "gerçekçi bir kuyruk ne kadar sürede açılıyor".
 */
const BEKLEYEN_IS_GUNU = 15;

/** Kaç takip maddesi açılsın; yarısı kapatılır. */
const TAKIP_MADDESI = 240;
/** Ölçen kişinin taslak listesi; üst sınır `MAX_DRAFTS_PER_USER` = 50. */
const TASLAK_SAYISI = 40;
/** Ekip izinleri ekranı için dönem sayısı. */
const IZIN_DONEMI = 60;
/** Zil kutusu ve ana ekran için bildirim sayısı. */
const BILDIRIM_SAYISI = 300;
/** İşlem kayıtları ekranı için ek denetim satırı. */
const DENETIM_KAYDI = 4000;

export interface YukOzeti {
  /** Global kurulum dâhil veritabanındaki toplam aktif kişi. */
  kisiSayisi: number;
  faaliyetSayisi: number;
  /** Onay kuyruğunda bekleyen kayıt (ölçülen `/approvals` bunu okuyor). */
  bekleyenOnay: number;
  /** Karara bağlanmış onay turu; onay süresi boyutu bunu okuyor. */
  kararliOnayTuru: number;
  takipMaddesi: number;
  taslak: number;
  izinDonemi: number;
  bildirim: number;
  denetimKaydi: number;
  skorDonemi: number;
  sureSaniye: number;
}

function isGunuMu(gun: Date): boolean {
  const g = gun.getUTCDay();
  return g !== 0 && g !== 6;
}

function gunMetni(gun: Date): string {
  return gun.toISOString().slice(0, 10);
}

/**
 * Karara bağlanmış bir onay geçmişinin faaliyet satırı.
 *
 * Toplu geçmiş servisten geçmiyor: on iki ayın her iş günü için
 * `createActivity` + `approveActivity` çağırmak binlerce ayrı işlem demek ve
 * yük üretimi dakikalarca sürerdi. Bunun yerine satırın **servisin
 * bıraktığıyla aynı şekilde** yazıldığı ayrı bir testle kanıtlanıyor:
 * `tests/kabul/yuk-verisi-bicimi.test.ts` gerçek servisleri çağırıp çıkan
 * satırı buradakiyle alan alan karşılaştırıyor. Kanıtsız "aynıdır" demek,
 * ölçümü üretimde imkânsız bir dünyada yapmak olurdu (P3-R2-1).
 */
export function onayliGecmisSatiri(girdi: {
  authorId: string;
  authorOrgUnitId: string;
  approverId: string;
  activityDate: Date;
  gonderim: Date;
  karar: Date;
}) {
  return {
    authorId: girdi.authorId,
    authorOrgUnitId: girdi.authorOrgUnitId,
    activityDate: girdi.activityDate,
    title: `Onaylanmış çalışma kaydı ${gunMetni(girdi.activityDate)}`,
    description:
      "Onaya tabi birimde yazılmış, müdürü tarafından onaylanmış kayıt. " +
      "Kabul koşusu için üretilmiş yük verisidir.",
    approvalStatus: "APPROVED" as const,
    approverId: girdi.approverId,
    // Karar verilirken gönderim anı **siliniyor**; onay süresi artık
    // değişmez `ApprovalRound` satırından okunuyor (P3-R2-1).
    approvalSubmittedAt: null,
    approvalDecidedAt: girdi.karar,
    createdAt: girdi.gonderim,
    updatedAt: girdi.karar,
  };
}

/** Aynı geçmişin kapanmış onay turu. */
export function onayliGecmisTuru(girdi: {
  activityId: string;
  decidedById: string;
  gonderim: Date;
  karar: Date;
}) {
  return {
    activityId: girdi.activityId,
    roundNo: 1,
    submittedAt: girdi.gonderim,
    decidedAt: girdi.karar,
    decidedById: girdi.decidedById,
    decision: "APPROVED" as const,
  };
}

export async function yukVerisiUret(): Promise<YukOzeti> {
  const baslangic = Date.now();

  // Hedef her çağrıda doğrulanır: uygulama veritabanına on bin sahte kayıt
  // yazmak gerçek veriyi geri döndürülemez biçimde kirletirdi.
  const hedef = process.env.E2E_DATABASE_URL ?? "";
  assertTestDatabaseUrl(hedef, {
    variableName: "E2E_DATABASE_URL",
    applicationUrl: process.env.DATABASE_URL,
  });

  const prisma = new PrismaClient({ datasources: { db: { url: hedef } } });

  try {
    return await uret(prisma, baslangic);
  } finally {
    await prisma.$disconnect();
  }
}

async function uret(prisma: PrismaClient, baslangic: number): Promise<YukOzeti> {
  const kok = await prisma.orgUnit.findFirst({ where: { parentId: null } });
  if (!kok) throw new Error("Kök birim yok; önce e2e kurulumu çalıştırın.");

  const birimler = await prisma.orgUnit.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  // Onaya tabi birim ve müdürü: bekleyen onay kuyruğu buradan doğuyor.
  const onayaTabi = birimler.find((b) => b.requiresApproval);
  if (!onayaTabi) {
    throw new Error(
      "Onaya tabi birim yok; `/approvals` ölçümü boş ekran ölçerdi. " +
        "E2E kurulumu Boyahane'yi kalıcı olarak onaya tabi yapıyor.",
    );
  }

  const onayci = await prisma.user.findFirst({
    where: { orgUnitId: onayaTabi.id, isUnitManager: true, isActive: true },
    select: { id: true },
  });
  if (!onayci) {
    throw new Error(`${onayaTabi.name} biriminde müdür yok; onaylayıcı çözülemez.`);
  }

  // Ölçen kişi: kökteki YK Başkanı. Kapsamı bütün şirket olduğu için en
  // büyük sonuç kümesiyle karşılaşan kişi odur; taslak ve izin gibi kişisel
  // yüzeylerin verisi de ona yazılıyor.
  const olcenKisi = await prisma.user.findFirst({
    where: { orgUnitId: kok.id, isUnitManager: true, isActive: true },
    select: { id: true, orgUnitId: true },
  });
  if (!olcenKisi) throw new Error("Kökte yönetici yok; ölçüm kapsamı kurulamaz.");

  // Skor **açıkça açılıyor.** Kapalıyken `/scores` hiç hesap yapmıyor ve
  // ölçülen şey boş bir ekranın süresi oluyordu. Ayar, yönetici panelinin
  // kullandığı servisten geçiyor: doğrudan satır yazmak ağırlık çapraz
  // doğrulamasını ve denetim izini atlardı.
  const ayar = await saveSettings(
    prisma,
    { [SETTING_KEYS.scoringEnabled]: "true" },
    olcenKisi.id,
  );
  if (!ayar.ok) throw new Error(`Skor ayarı açılamadı: ${ayar.message}`);

  const parola = await hashPassword("kabul-kosusu-parolasi-1234");

  // **Kişiler tarihçenin başından beri var.** Kapanış artık "dönemde mevcut
  // muydu" diye soruyor (denetim 25.08.2026, P8-R2-3); bugün açılmış
  // kullanıcıya geçmiş dönem karnesi yazılmıyor. Üretilen şirket on iki aylık
  // bir geçmişe sahip olduğuna göre kişileri de o tarihte işe başlamış.
  const simdi = new Date();
  const iseBaslama = new Date(
    Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth() - AY_SAYISI - 1, 1),
  );

  // ---- Kişiler ------------------------------------------------------------
  const mevcutAktifKisiSayisi = await prisma.user.count({
    where: { isActive: true },
  });
  const eklenecekKisiSayisi = eksikYukKisiSayisi(mevcutAktifKisiSayisi);
  const kisiler: { id: string; orgUnitId: string; requiresApproval: boolean }[] = [];
  for (let i = 0; i < eklenecekKisiSayisi; i += 1) {
    const birim = birimler[i % birimler.length];
    if (!birim) continue;

    const user = await prisma.user.upsert({
      where: { email: `yuk-${i}@kabul.test` },
      update: {},
      create: {
        fullName: `Yük Kullanıcısı ${i + 1}`,
        title: i % 5 === 0 ? "Uzman" : "Operatör",
        email: `yuk-${i}@kabul.test`,
        orgUnitId: birim.id,
        createdAt: iseBaslama,
      },
    });
    await prisma.userCredential.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, passwordHash: parola },
    });

    kisiler.push({
      id: user.id,
      orgUnitId: birim.id,
      requiresApproval: birim.requiresApproval,
    });
  }

  // Kurulumun açtığı hesaplar da tarihçenin başından beri var sayılıyor:
  // ölçen kişinin `/scores` ekranı boş kalmasın.
  await prisma.user.updateMany({
    where: { createdAt: { gt: iseBaslama } },
    data: { createdAt: iseBaslama },
  });

  const toplamAktifKisiSayisi = await prisma.user.count({
    where: { isActive: true },
  });
  if (toplamAktifKisiSayisi !== HEDEF_AKTIF_KISI_SAYISI) {
    throw new Error(
      "Kabul yükü şirket büyüklüğünü kuramadı: " +
        `beklenen ${HEDEF_AKTIF_KISI_SAYISI}, gerçek ${toplamAktifKisiSayisi}.`,
    );
  }

  // Ölçen kişi de yazar. `/activities` "Faaliyetlerim" ekranı ve yalnız
  // kişinin **kendi** kayıtlarını listeliyor; ölçen kişinin hiç kaydı
  // olmasaydı o ekranın ölçümü boş listenin süresi olurdu.
  const yazanlar = [
    ...kisiler,
    { id: olcenKisi.id, orgUnitId: olcenKisi.orgUnitId, requiresApproval: kok.requiresApproval },
  ];

  // ---- İş günleri ---------------------------------------------------------
  const bugun = new Date();
  const ilkGun = new Date(
    Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth() - AY_SAYISI, 1),
  );

  const isGunleri: Date[] = [];
  const imlec = new Date(ilkGun);
  while (imlec <= bugun) {
    if (isGunuMu(imlec)) isGunleri.push(new Date(imlec));
    imlec.setUTCDate(imlec.getUTCDate() + 1);
  }

  // Son günler onay kuyruğunda bekleyecek; öncesi karara bağlanmış geçmiş.
  const bekleyenSinir = Math.max(0, isGunleri.length - BEKLEYEN_IS_GUNU);
  const gecmisGunler = isGunleri.slice(0, bekleyenSinir);
  const bekleyenGunler = isGunleri.slice(bekleyenSinir);

  // ---- Toplu geçmiş -------------------------------------------------------
  const onaysizSatirlar: ReturnType<typeof duzFaaliyetSatiri>[] = [];
  const onayliSatirlar: ReturnType<typeof onayliGecmisSatiri>[] = [];

  for (const gun of gecmisGunler) {
    for (const kisi of yazanlar) {
      if (kisi.requiresApproval) {
        const gonderim = new Date(gun.getTime() + 9 * 3600_000);
        onayliSatirlar.push(
          onayliGecmisSatiri({
            authorId: kisi.id,
            authorOrgUnitId: kisi.orgUnitId,
            approverId: onayci.id,
            activityDate: gun,
            gonderim,
            // Karar ertesi gün: onay süresi boyutu ölçülebilir bir değer bulur.
            karar: new Date(gonderim.getTime() + 26 * 3600_000),
          }),
        );
      } else {
        onaysizSatirlar.push(duzFaaliyetSatiri(kisi, gun));
      }
    }
  }

  // Toplu yazım parçalara bölünüyor: tek `createMany` on binlerce satırda
  // sorgu boyutu sınırına takılıyor.
  const PARCA = 2000;
  for (let i = 0; i < onaysizSatirlar.length; i += PARCA) {
    await prisma.activity.createMany({ data: onaysizSatirlar.slice(i, i + PARCA) });
  }
  for (let i = 0; i < onayliSatirlar.length; i += PARCA) {
    await prisma.activity.createMany({ data: onayliSatirlar.slice(i, i + PARCA) });
  }

  // Toplu yazılan her kaydın **yan satırları**. Üretimde bunlar kayıtla
  // birlikte doğuyor; eksik bırakmak veritabanını üretimde imkânsız bir
  // duruma sokar ve ölçüm başka bir dünyayı ölçer:
  //
  //   · muhatap departman — kaydın konusu (§5.3),
  //   · birinci revizyon — her kaydetme değişmez revizyon üretir (§5.5),
  //   · kapanmış onay turu ve dondurulmuş onaylayıcı listesi — onay
  //     süresinin ve görünürlüğün okunduğu yer.
  //
  // Bu noktada veritabanındaki tek faaliyet kümesi az önce toplu yazılan
  // geçmiş: kurulum hiç faaliyet üretmiyor, servisle yazılanlar ise sonra
  // geliyor.
  const topluKayitlar = await prisma.activity.findMany({
    select: {
      id: true,
      authorId: true,
      authorOrgUnitId: true,
      title: true,
      description: true,
      createdAt: true,
      approverId: true,
      approvalDecidedAt: true,
    },
  });

  for (let i = 0; i < topluKayitlar.length; i += PARCA) {
    const dilim = topluKayitlar.slice(i, i + PARCA);

    await prisma.activityTargetDept.createMany({
      data: dilim.map((k) => ({
        activityId: k.id,
        orgUnitId: k.authorOrgUnitId,
      })),
    });

    await prisma.activityRevision.createMany({
      data: dilim.map((k) => ({
        activityId: k.id,
        revisionNo: 1,
        title: k.title,
        description: k.description,
        targetOrgUnitIds: [k.authorOrgUnitId],
        changedById: k.authorId,
        createdAt: k.createdAt,
      })),
    });

    const onaylananlar = dilim.filter((k) => k.approverId !== null);
    if (onaylananlar.length === 0) continue;

    await prisma.approvalRound.createMany({
      data: onaylananlar.map((k) =>
        onayliGecmisTuru({
          activityId: k.id,
          decidedById: k.approverId ?? onayci.id,
          gonderim: k.createdAt,
          karar: k.approvalDecidedAt ?? k.createdAt,
        }),
      ),
    });
    await prisma.activityApprover.createMany({
      data: onaylananlar.map((k) => ({
        activityId: k.id,
        userId: k.approverId ?? onayci.id,
      })),
    });
  }

  // ---- Bekleyen onay kuyruğu: gerçek servisle ----------------------------
  //
  // Bu satırları ölçülen `/approvals` ekranı okuyor. Elle kurulmuş bir
  // "bekleyen" kayıt üretimde imkânsız olabilir; kuyruğu servisin kendisi
  // dolduruyor: durum, onay turu, uygun onaylayıcı listesi ve bildirim
  // hepsi aynı yazma yolundan geliyor.
  const hedefBirimler = [onayaTabi.id];
  let bekleyenOnay = 0;
  for (const gun of bekleyenGunler) {
    for (const kisi of yazanlar) {
      if (!kisi.requiresApproval) {
        // Onaya tabi olmayan birimde kayıt doğrudan onaylı doğuyor; bu da
        // gerçek yazma yolundan geçiyor ki son günlerin verisi de üretimde
        // mümkün olan biçimde olsun.
        const duz = await createActivity(
          prisma,
          { id: kisi.id, orgUnitId: kisi.orgUnitId, requiresApproval: false },
          {
            activityDate: gunMetni(gun),
            title: `Günlük çalışma kaydı ${gunMetni(gun)}`,
            description:
              "Vardiya boyunca yürütülen işler, karşılaşılan sorunlar ve " +
              "çözümleri. Kabul koşusu için üretilmiş yük verisidir.",
            targetDepartmentIds: [kisi.orgUnitId],
          },
          new Date(gun.getTime() + 9 * 3600_000),
        );
        if (!duz.ok) {
          throw new Error(`Günlük kayıt yazılamadı (${gunMetni(gun)}): ${duz.error}`);
        }
        continue;
      }

      const sonuc = await createActivity(
        prisma,
        { id: kisi.id, orgUnitId: kisi.orgUnitId, requiresApproval: true },
        {
          activityDate: gunMetni(gun),
          title: `Onay bekleyen çalışma kaydı ${gunMetni(gun)}`,
          description:
            "Onaya tabi birimde yazılmış, müdürünün kararını bekleyen kayıt. " +
            "Kabul koşusu için üretilmiş yük verisidir.",
          targetDepartmentIds: hedefBirimler,
        },
        new Date(gun.getTime() + 9 * 3600_000),
      );

      if (!sonuc.ok) {
        throw new Error(
          `Bekleyen kayıt yazılamadı (${gunMetni(gun)}): ${sonuc.error}`,
        );
      }
      bekleyenOnay += 1;
    }
  }

  // ---- Takip maddeleri: gerçek servisle -----------------------------------
  const takipAdaylari = await prisma.activity.findMany({
    where: { approvalStatus: "APPROVED" },
    select: { id: true, authorId: true },
    orderBy: { activityDate: "desc" },
    take: TAKIP_MADDESI,
  });

  let takipMaddesi = 0;
  for (const [sira, kayit] of takipAdaylari.entries()) {
    // Açan kişi kaydın yazarı: kendi kaydını her zaman görür ve görünürlük
    // denetimi gerçek yoldan geçer.
    const acan = { id: kayit.authorId, isSystemAdmin: false };
    const acildi = await openFollowUp(prisma, acan, {
      activityId: kayit.id,
      nextStep: "Sonraki adım: konu takip ediliyor.",
    });
    if (!acildi.ok) continue;
    takipMaddesi += 1;

    // Yarısı kapalı: ekran hem açık hem kapanmış maddeyi çiziyor ve süzgeç
    // sayacı ancak ikisi de varken anlamlı.
    if (sira % 2 === 1) {
      await closeFollowUp(
        prisma,
        acan,
        acildi.item.id,
        "Konu tamamlandı; kabul koşusu yük verisidir.",
      );
    }
  }

  // ---- Taslaklar: gerçek servisle ----------------------------------------
  let taslak = 0;
  for (let i = 0; i < TASLAK_SAYISI; i += 1) {
    const sonuc = await saveDraft(prisma, olcenKisi.id, {
      activityDate: gunMetni(isGunleri[isGunleri.length - 1] ?? bugun),
      title: `Yarım kalan kayıt ${i + 1}`,
      description: "Taslak listesi ölçümü için üretilmiş yük verisidir.",
      targetDepartmentIds: [],
      openFollowUp: false,
      savedManually: i % 3 === 0,
    });
    if (sonuc.ok) taslak += 1;
  }

  // ---- İzin dönemleri: gerçek servisle ------------------------------------
  //
  // Ölçen kişi kökte yönetici olduğu için bütün yük kullanıcıları onun
  // kapsamında; servis "astım mı" kontrolünü gerçekten yapıyor.
  let izinDonemi = 0;
  for (let i = 0; i < IZIN_DONEMI; i += 1) {
    const kisi = kisiler[i % kisiler.length];
    if (!kisi) continue;

    // Çakışma kısıtı (`EXCLUDE`) aynı kişide üst üste binen dönemi
    // reddediyor; her tur için ayrı bir hafta seçiliyor.
    const tur = Math.floor(i / kisiler.length);
    const bas = new Date(ilkGun);
    bas.setUTCDate(bas.getUTCDate() + 30 + tur * 21 + (i % 7));
    const bit = new Date(bas);
    bit.setUTCDate(bit.getUTCDate() + 2);

    const sonuc = await markNoActivityPeriod(
      prisma,
      olcenKisi.id,
      {
        userId: kisi.id,
        startDate: gunMetni(bas),
        endDate: gunMetni(bit),
        note: "Yıllık izin — kabul koşusu yük verisidir.",
      },
      bugun,
    );
    if (sonuc.ok) izinDonemi += 1;
  }

  // ---- Bildirimler --------------------------------------------------------
  //
  // Kabuk her sayfada okunmamış sayısını okuyor; boş kutuyla ölçmek o
  // sorgunun maliyetini gizlerdi.
  const bildirimKayitlari = await prisma.activity.findMany({
    select: { id: true },
    orderBy: { activityDate: "desc" },
    take: BILDIRIM_SAYISI,
  });
  await prisma.notificationQueue.createMany({
    data: bildirimKayitlari.map((k, i) => ({
      userId: olcenKisi.id,
      eventType: "activity_created",
      activityId: k.id,
      channel: "EMAIL" as const,
      payload: { baslik: `Yük bildirimi ${i + 1}` },
      idempotencyKey: `yuk-bildirim:${k.id}:${olcenKisi.id}`,
      status: "SENT" as const,
      sentAt: bugun,
    })),
    skipDuplicates: true,
  });
  const bildirim = await prisma.notificationQueue.count({
    where: { userId: olcenKisi.id },
  });

  // ---- Denetim izi --------------------------------------------------------
  //
  // Servisler koştukça denetim satırı zaten doğdu; işlem kayıtları ekranı
  // gerçekçi bir hacimle ölçülsün diye üstüne geçmiş yazılıyor.
  const denetimAdaylari = await prisma.activity.findMany({
    select: { id: true, authorId: true, createdAt: true },
    orderBy: { activityDate: "desc" },
    take: DENETIM_KAYDI,
  });
  for (let i = 0; i < denetimAdaylari.length; i += PARCA) {
    await prisma.auditLog.createMany({
      data: denetimAdaylari.slice(i, i + PARCA).map((k) => ({
        userId: k.authorId,
        objectType: "activity",
        objectId: k.id,
        action: "activity_created",
        detail: { kaynak: "kabul-yuk-verisi" },
        createdAt: k.createdAt,
      })),
    });
  }
  const denetimKaydi = await prisma.auditLog.count();

  // ---- Skor dönemleri: gerçek kapanış işçisiyle ---------------------------
  //
  // `UserScorePeriod` satırlarını elle yazmak, formülü atlayıp ölçümü
  // uydurma sayılarla yapmak olurdu. Kapanış işçisi her ay için bir kez
  // çağrılıyor; ürettiği satırlar üretimdekiyle aynı yoldan geçiyor.
  let skorDonemi = 0;
  for (let ay = AY_SAYISI; ay >= 1; ay -= 1) {
    // Ayın **üçü**: kapanış, geriye giriş penceresi kapanmadan dönemi
    // dondurmuyor (denetim 25.08.2026, P8-R2-2). Ayın 1'inde koşan
    // kapanış hiçbir dönem yazmazdı.
    const kapanisAni = new Date(
      Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth() - ay + 1, 3, 3),
    );
    const sonuc = await closeScorePeriod(prisma, kapanisAni);
    skorDonemi += sonuc.written;
  }

  const faaliyetSayisi = await prisma.activity.count();
  const kararliOnayTuru = await prisma.approvalRound.count({
    where: { decidedAt: { not: null } },
  });

  return {
    kisiSayisi: toplamAktifKisiSayisi,
    faaliyetSayisi,
    bekleyenOnay,
    kararliOnayTuru,
    takipMaddesi,
    taslak,
    izinDonemi,
    bildirim,
    denetimKaydi,
    skorDonemi,
    sureSaniye: Number(((Date.now() - baslangic) / 1000).toFixed(1)),
  };
}

/** Onaya tabi olmayan birimde kayıt doğrudan onaylı doğar (§4.3). */
function duzFaaliyetSatiri(
  kisi: { id: string; orgUnitId: string },
  gun: Date,
) {
  return {
    authorId: kisi.id,
    // Yazım anındaki birim dondurulur (§4.6).
    authorOrgUnitId: kisi.orgUnitId,
    activityDate: gun,
    title: `Günlük çalışma kaydı ${gunMetni(gun)}`,
    description:
      "Vardiya boyunca yürütülen işler, karşılaşılan sorunlar ve " +
      "çözümleri. Kabul koşusu için üretilmiş yük verisidir.",
  };
}

// Betik olarak da çalıştırılabilir. **`scripts/` altında değil**: üretim
// imajı `tests/` klasörünü içermiyor ve oradan `tests/helpers`'a bakan bir
// dosya `docker build` sırasında tip denetimini kırıyordu (Görev 6.3'te
// yakalandı).
if (process.argv[1]?.endsWith("kabul-yuk-verisi.ts")) {
  yukVerisiUret()
    .then((s) => console.log("Yük verisi hazır:", JSON.stringify(s, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
