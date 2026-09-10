import { Prisma } from "@prisma/client";

import { companyDay, toDateValue } from "@/server/activities/date-rules";

import { allDeputyPeriods } from "./deputy";
import type { ActivityApprovalStatus, PrismaClient } from "@prisma/client";


// GÖRÜNÜRLÜK KATMANI (§8) — bu dosya sistemin en tehlikeli hata yüzeyidir.
// Buradaki bir hata hiçbir ekranda görünmez, sessizce veri sızdırır. Sızıntı
// toleransı sıfırdır (§18.4).
//
// **Her okuma yolu buradan geçer:** liste, detay, arama, ek indirme ve ileride
// raporlar. Bir okuma yolu kendi filtresini yazıyorsa, o yol yanlıştır.
//
// Temel kural (§8.1): kişi, organizasyon ağacında **kendi altında kalan**
// kullanıcıların **onaylanmış** faaliyetlerini görür. Kendi birimindeki diğer
// kullanıcılar buna dahil değildir — yalnızca birim yöneticisi kendi birimini
// görür, çünkü §4.4'e göre onların yöneticisidir. İki akran birbirini görmez.
// Kişi kendi faaliyetlerini her durumda görür.

/**
 * Görünürlük seviyesi.
 * - `none`: kayıt hiç gösterilmez, varlığı bile bildirilmez.
 * - `metadata`: yalnızca yönlendirme için gereken üst veri (yazar, tarih,
 *   başlık). Açıklama ve ekler **yoktur** (§8.2 sistem yöneticisi istisnası).
 * - `full`: içerik dahil.
 */
export type VisibilityLevel = "none" | "metadata" | "full";

export type VisibilityDb = Pick<
  PrismaClient,
  // `noActivityPeriod`: vekâlet kapsamı buradan okunuyor (§4.5). Görünürlük
  // artık yalnız ağaca değil, aktif vekâlet dönemlerine de bakıyor.
  | "user"
  | "orgUnit"
  | "activity"
  | "activityApprover"
  | "noActivityPeriod"
  | "$queryRaw"
>;

export interface Viewer {
  id: string;
  /** İşlevsel yetki; ağaçtan gelmeyen içerik erişimi vermez (§15.1). */
  isSystemAdmin: boolean;
}

export interface ReportScopeUnit {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

export interface ReportScopePerson {
  id: string;
  orgUnitId: string;
}

export interface ReportScope {
  rootOrgUnitId: string;
  rootOrgUnitName: string;
  unitIds: string[];
  userIds: string[];
  units: ReportScopeUnit[];
  people: ReportScopePerson[];
  isSystemAdmin: boolean;
  canViewScoreReports: boolean;
}

/**
 * Toplu raporların tek kapsam kapısı.
 *
 * Raporlar tek tek faaliyet göstermez; buna rağmen kişi ve birim sayıları
 * çalışma düzeni hakkında bilgi taşıdığı için normal faaliyet görünürlüğünden
 * bağımsız bir yetki olarak korunur. Yetki verildikten sonra kapsam, aktif
 * kullanıcının bağlı olduğu birimden aşağı doğru çözülür.
 */
export async function visibleReportScope(
  db: VisibilityDb,
  viewerId: string,
): Promise<ReportScope | null> {
  const actor = await db.user.findUnique({
    where: { id: viewerId },
    select: {
      orgUnitId: true,
      isActive: true,
      isSystemAdmin: true,
      canViewReports: true,
      canViewScoreReports: true,
    },
  });

  if (!actor?.isActive || !actor.canViewReports) return null;

  const units = await db.$queryRaw<ReportScopeUnit[]>`
    WITH RECURSIVE subtree("id", "name", "parentId", depth) AS (
      SELECT "id", "name", "parentId", 0
      FROM "OrgUnit"
      WHERE "id" = ${actor.orgUnitId}
        AND "isActive" = TRUE
      UNION ALL
      SELECT child."id", child."name", child."parentId", subtree.depth + 1
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree."id"
      WHERE child."isActive" = TRUE
    )
    SELECT "id", "name", "parentId", depth
    FROM subtree
    ORDER BY depth, "name"
  `;

  if (units.length === 0) return null;

  const unitIds = units.map((unit) => unit.id);
  // Pasifleştirilmiş kullanıcıların geçmiş faaliyetleri, izinleri ve skorları
  // raporlarda kaybolmamalı. Birim ağacı aktif olduğu sürece tarihsel toplamın
  // korunması raporun anlamlı kalmasını sağlar. Hesabı pasif olan kişi yine de
  // yeni işlem üretemez; burada yalnızca zaten var olan kayıtların sahibi
  // olarak kapsama alınır.
  const people = await db.user.findMany({
    where: { orgUnitId: { in: unitIds } },
    select: { id: true, orgUnitId: true },
  });

  return {
    rootOrgUnitId: actor.orgUnitId,
    rootOrgUnitName: units.find((unit) => unit.id === actor.orgUnitId)?.name ?? "",
    unitIds,
    userIds: people.map((person) => person.id),
    units,
    people,
    isSystemAdmin: actor.isSystemAdmin,
    canViewScoreReports: actor.canViewScoreReports,
  };
}

export interface ActivityForVisibility {
  /**
   * Kaydın kimliği.
   *
   * Onaylayıcı yetkisi **kayda yazılmış listeden** okunuyor; kimlik onun
   * için gerekli. Eskiden burada kimlik yoktu ve onaylayıcı ağaçtan canlı
   * çözülüyordu — liste tarafı ise donmuş listeye bakıyordu. Ağaç
   * değiştiğinde ikisi ayrışıyordu ve **sızıntı yönünde**: birime sonradan
   * atanan bir müdür, kendisine hiç düşmemiş bir kaydın detayını
   * açabiliyordu (21.08.2026'da denklik testiyle yakalandı).
   */
  id: string;
  authorId: string;
  approvalStatus: ActivityApprovalStatus;
}

/** Üst zincirin görebildiği durumlar (§8.2). */
const CHAIN_VISIBLE_STATUSES: ActivityApprovalStatus[] = ["APPROVED", "CANCELLED"];

/**
 * Aktif onaylayıcının görebildiği durumlar (§8.2 matrisi).
 *
 * Yalnız bu iki durum: onay süreci bitince kayıt zaten `APPROVED` olur ve
 * herkes gibi zincir kuralından görünür. Onaylayıcıya kalıcı bir ayrıcalık
 * verilmez — gördüğü şey, **kendi önünde duran iş**tir.
 */
const APPROVER_VISIBLE_STATUSES: ActivityApprovalStatus[] = [
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  // Reddettiği kaydı görmeye devam eder: kararının arkasında durabilmesi ve
  // yazan itiraz ettiğinde neye baktığını hatırlayabilmesi için. Üst zincire
  // ise **hiç** akmaz — süzgecin bütün amacı bu.
  "REJECTED",
];

/**
 * Tek bir faaliyet için görünürlük kararı (§8.2 matrisi).
 *
 * **Liste süzgecinin kendisini kullanır.** Eskiden kural burada ikinci kez,
 * elle yazılıydı; iki gösterim 21.08.2026'da iki ayrı biçimde ayrıştı:
 *
 *   · aynı birimde iki yönetici olunca kayıt listede görünüyor ama detayı
 *     açılmıyordu,
 *   · onaylayıcı burada ağaçtan canlı çözülüyordu, listede ise kayda
 *     donmuş listeden — **sızıntı yönünde** bir fark.
 *
 * Şimdi kural tek yerde: aynı `where` alınıyor ve "bu kayıt o kümede mi"
 * diye soruluyor. İki tarafın ayrışması artık yapısal olarak mümkün değil.
 * Denklik testi yine duruyor — birileri ikisini tekrar ayırmaya kalkarsa
 * yakalasın diye.
 *
 * Rol, ağaçtan gelmeyen bir erişim **eklemez**; yalnızca "yönetici
 * bulunamadı" kayıtlarında müdahale için üst veri açar ve o yüzey ayrı bir
 * sorgudan beslenir (`listInterventionQueue`).
 */
export async function canViewActivity(
  db: VisibilityDb,
  viewer: Viewer,
  activity: ActivityForVisibility,
  /** Önceden hesaplanmış astlar; aynı istekte tekrar sorgulanmasın diye. */
  precomputedSubordinates?: string[],
  now: Date = new Date(),
): Promise<VisibilityLevel> {
  const kapsam = await visibleActivityWhere(
    db,
    viewer,
    precomputedSubordinates,
    now,
  );

  const gorunur = await db.activity.findFirst({
    where: { AND: [{ id: activity.id }, kapsam] },
    select: { id: true },
  });

  if (gorunur) return "full";

  if (viewer.isSystemAdmin && activity.approvalStatus === "MANAGER_NOT_FOUND") {
    return "metadata";
  }

  return "none";
}

/**
 * Kişinin altındaki kullanıcıların kimlikleri.
 *
 * Yalnızca birim yöneticisinin astı vardır (§4.4): yönetici olmayan kişinin
 * kendi birimindeki akranları bile kapsamına girmez. Alt ağaç özyinelemeli
 * sorguyla çözülür (§16.6).
 */
export async function subordinateUserIds(
  db: VisibilityDb,
  viewerId: string,
): Promise<string[]> {
  const viewer = await db.user.findUnique({
    where: { id: viewerId },
    select: { orgUnitId: true, isUnitManager: true },
  });

  if (!viewer || !viewer.isUnitManager) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree(id) AS (
      SELECT "id" FROM "OrgUnit" WHERE "id" = ${viewer.orgUnitId}
      UNION ALL
      SELECT child."id"
      FROM "OrgUnit" child
      JOIN subtree ON child."parentId" = subtree.id
    )
    SELECT u."id"
    FROM "User" u
    JOIN subtree ON u."orgUnitId" = subtree.id
    WHERE u."id" <> ${viewerId}
  `;

  return rows.map((row) => row.id);
}

/**
 * Vekâletten doğan görünürlük koşulları.
 *
 * Her vekâlet dönemi **tarihle sınırlı bir pencere** açar: o birimin, o tarih
 * aralığına ait kayıtları. Pencere süresiz kalır — vekâlet bittikten aylar
 * sonra o döneme dair bir soru gelirse vekil cevap verebilmeli (ürün sahibi
 * kararı, 21.08.2026).
 *
 * **Pencere dışına taşmaz.** Vekil, vekâlet ettiği birimin daha eski
 * kayıtlarını hiçbir zaman görmez: bir haftalık izin, yılların arşivine kapı
 * açmamalı. Kapsamı düz bir "ast listesi" olarak eklemek bunu ifade edemezdi;
 * tarih koşulu her pencereye ayrı ayrı bağlanıyor.
 *
 * Aktif dönemde ayrıca **onay kuyruğu** açılır ve o tarihsizdir: devralınan
 * kuyrukta vekâletten önce yazılmış kayıtlar olabilir ve vekil tam da onları
 * karara bağlamak için oradadır.
 */
async function deputyClauses(
  db: VisibilityDb,
  viewerId: string,
  now: Date,
): Promise<Prisma.ActivityWhereInput[]> {
  const donemler = await allDeputyPeriods(db, viewerId);
  if (donemler.length === 0) return [];

  // Aynı kişiye birden çok kez vekâlet edilmiş olabilir; alt ağaç sorgusu
  // kişi başına bir kez koşar.
  const kapsamlar = new Map<string, string[]>();
  for (const donem of donemler) {
    if (kapsamlar.has(donem.personId)) continue;

    const astlar = await subordinateUserIds(db, donem.personId);
    // Vekâlet edilen kişinin **kendi** kayıtları da pencereye girer.
    kapsamlar.set(donem.personId, [donem.personId, ...astlar]);
  }

  const clauses: Prisma.ActivityWhereInput[] = donemler.map((donem) => ({
    authorId: { in: kapsamlar.get(donem.personId) ?? [] },
    activityDate: { gte: donem.startDate, lte: donem.endDate },
    approvalStatus: { in: CHAIN_VISIBLE_STATUSES },
  }));

  // Aktif vekâletin açtığı onay kuyruğu. Tek sorguda ifade ediliyor:
  // "önce vekâletleri oku, sonra o kimliklerle ara" iki ayrı okuma demekti ve
  // arada vekâlet değişirse ikinci sorgu artık geçersiz bir listeyle çalışırdı
  // (denetim 21.08.2026, bulgu 2).
  clauses.push({
    ...approvalQueueWhere(viewerId, now),
    approvalStatus: { in: APPROVER_VISIBLE_STATUSES },
  });

  return clauses;
}

/**
 * "Onayı bana düşen kayıtlar" koşulu — kendi adıma ya da vekâleten.
 *
 * **Tek sorgudur ve bilerek öyledir.** Vekâlet kimliklerini önce okuyup sonra
 * `in: [...]` ile aramak iki ayrı okumadır; arada vekâlet iptal edilirse
 * ikinci sorgu artık var olmayan bir yetkiyle çalışır ve yetkisiz kişiye
 * içerik döndürür. İç içe ilişki süzgeci tek bir SQL cümlesine indiği için
 * böyle bir aralık kalmaz.
 *
 * Onay kuyruğunu okuyan **bütün** yollar (iş kuyruğu, onay ekranı, gruplu
 * onay) buradan geçer; her birinin kendi süzgecini yazması, birinin diğerinden
 * sessizce ayrışması demekti.
 */
export function approvalQueueWhere(
  viewerId: string,
  now: Date = new Date(),
): Prisma.ActivityWhereInput {
  const bugun = toDateValue(companyDay(now));

  return {
    eligibleApprovers: {
      some: {
        OR: [
          { userId: viewerId },
          // Vekâlet: onaylayıcının, bu tarihleri kapsayan ve **iptal
          // edilmemiş** bir döneminde vekili benim.
          {
            user: {
              noActivityPeriods: {
                some: {
                  deputyId: viewerId,
                  cancelledAt: null,
                  status: "APPROVED",
                  startDate: { lte: bugun },
                  endDate: { gte: bugun },
                },
              },
            },
          },
        ],
      },
    },
  };
}

/**
 * Liste, arama ve sayım sorgularının kullanacağı filtre. Kapsam dışındaki hiçbir
 * kayıt bu filtreden geçemez; çağıran kendi `where` koşulunu bununla
 * **birleştirir**, yerine koymaz.
 */
export async function visibleActivityWhere(
  db: VisibilityDb,
  viewer: Viewer,
  /** Önceden hesaplanmış kapsam; aynı istekte tekrar tekrar sorgulanmasın diye. */
  precomputedSubordinates?: string[],
  now: Date = new Date(),
): Promise<Prisma.ActivityWhereInput> {
  const subordinates =
    precomputedSubordinates ?? (await subordinateUserIds(db, viewer.id));

  const clauses: Prisma.ActivityWhereInput[] = [
    { authorId: viewer.id },
    // **Kararını verdiğin kayıt sana görünür kalır** (21.08.2026).
    //
    // `approverId` karardan sonra kararı veren kişiyi taşıyor. Onayladığı
    // kaydı bir daha göremeyen kişi, verdiği kararın arkasında duramaz;
    // vekâleti biten bir vekile kalan tek görünürlük de budur.
    //
    // **Yalnız karar, katılım değil.** İlk denemede "cevap yazdığın kayıt"
    // da eklenmişti; §4.6 ile çatıştı: başka dala taşınan biri, bir zamanlar
    // soru sorduğu için erişimini süresiz koruyordu ve mevcut test bunu
    // yakaladı. Karar vermek ile konuşmaya katılmak aynı ağırlıkta değil —
    // biri hesap verilecek bir eylem, diğeri bir mesaj.
    { approverId: viewer.id },
    // Uygun onaylayıcılar listesi (§8.2). Onaylayıcı **kayda yazılıdır**; her
    // listede §4.4'ü yeniden çözmek hem pahalı olurdu hem de ağaç değişince
    // akıştaki işi sessizce başkasına devretmek anlamına gelirdi.
    //
    // Tek sütun yerine liste: bir birimde birden fazla müdür olabilir ve
    // kayıt hepsinin önünde durur (20.08.2026 kararı).
    {
      eligibleApprovers: { some: { userId: viewer.id } },
      approvalStatus: { in: APPROVER_VISIBLE_STATUSES },
    },
  ];

  clauses.push(...(await deputyClauses(db, viewer.id, now)));

  if (subordinates.length > 0) {
    clauses.push({
      authorId: { in: subordinates },
      approvalStatus: { in: CHAIN_VISIBLE_STATUSES },
    });
  }

  return { OR: clauses };
}

/**
 * Aynı kuralın SQL karşılığı. Tam metin araması Prisma'nın filtresiyle
 * ifade edilemiyor (Türkçe sözlük ve `title || ' ' || description` üzerindeki
 * GIN indeksi) ve arama, görünürlük süzgecini **sorgunun içinde** taşımak
 * zorunda: önce metinle eşleşenleri bulup sonra daraltmak, kullanıcının
 * göremediği kayıtların aday listesini doldurmasına ve kendi sonuçlarının
 * sessizce dışarıda kalmasına yol açardı.
 *
 * Kural yine tek yerde: iki gösterim de aynı dosyada, aynı sabitlerden
 * besleniyor ve `visible-sql-denklik.test.ts` ikisinin **aynı kümeyi**
 * döndürdüğünü rastgele senaryolarda doğruluyor.
 *
 * `alias` çağıran sorgudaki tablo takma adıdır.
 */
export async function visibleActivitySql(
  db: VisibilityDb,
  viewer: Viewer,
  alias: string,
  precomputedSubordinates?: string[],
  now: Date = new Date(),
): Promise<Prisma.Sql> {
  const subordinates =
    precomputedSubordinates ?? (await subordinateUserIds(db, viewer.id));
  const vekaletDonemleri = await allDeputyPeriods(db, viewer.id);
  const bugun = toDateValue(companyDay(now));

  // Takma ad koddan gelir, kullanıcıdan değil; yine de kısıtlanır ki bu
  // fonksiyon ileride yanlışlıkla dış girdiyle çağrılmasın.
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Geçersiz tablo takma adı: ${alias}`);
  }

  const own = Prisma.sql`${Prisma.raw(`"${alias}"."authorId"`)} = ${viewer.id}`;

  // Prisma tarafındaki "kararını verdiğin kayıt" kuralının ikizi.
  const dokundugu = Prisma.sql`${Prisma.raw(`"${alias}"."approverId"`)} = ${viewer.id}`;

  // Prisma tarafındaki `eligibleApprovers: { some: … }` ile **aynı** küme.
  // Denklik `visible-sql-denklik.test.ts` ile rastgele senaryolarda sınanıyor.
  const approver = Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "ActivityApprover" aa
      WHERE aa."activityId" = ${Prisma.raw(`"${alias}"."id"`)}
        AND aa."userId" = ${viewer.id}
    )
    AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${APPROVER_VISIBLE_STATUSES}::text[])
  )`;

  // Vekâlet süresince: vekâlet edilenin onayına düşmüş kayıtlar. Tarihsiz —
  // devralınan kuyrukta vekâletten önce yazılmış kayıtlar olabilir.
  //
  // Vekâlet **sorgunun içinde** çözülür, önceden okunan bir kimlik listesiyle
  // değil (denetim 21.08.2026, bulgu 2). Prisma tarafındaki
  // `approvalQueueWhere` ile aynı küme.
  const vekilKuyrugu = Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "ActivityApprover" aa
      WHERE aa."activityId" = ${Prisma.raw(`"${alias}"."id"`)}
        AND EXISTS (
          SELECT 1 FROM "NoActivityPeriod" p
          WHERE p."userId" = aa."userId"
            AND p."deputyId" = ${viewer.id}
            AND p."cancelledAt" IS NULL
            AND p."status" = 'APPROVED'
            AND p."startDate" <= ${bugun}
            AND p."endDate" >= ${bugun}
        )
    )
    AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${APPROVER_VISIBLE_STATUSES}::text[])
  )`;

  // Her vekâlet dönemi, o birimin **o tarih aralığına ait** kayıtlarını açar
  // ve pencere süresiz kalır. Prisma tarafındaki `deputyClauses` ile aynı.
  const vekilPencereleri: Prisma.Sql[] = [];
  const pencereKapsamlari = new Map<string, string[]>();

  for (const donem of vekaletDonemleri) {
    let kapsam = pencereKapsamlari.get(donem.personId);
    if (!kapsam) {
      kapsam = [donem.personId, ...(await subordinateUserIds(db, donem.personId))];
      pencereKapsamlari.set(donem.personId, kapsam);
    }

    vekilPencereleri.push(Prisma.sql`(
      ${Prisma.raw(`"${alias}"."authorId"`)} = ANY(${kapsam}::text[])
      AND ${Prisma.raw(`"${alias}"."activityDate"`)} >= ${donem.startDate}
      AND ${Prisma.raw(`"${alias}"."activityDate"`)} <= ${donem.endDate}
      AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${CHAIN_VISIBLE_STATUSES}::text[])
    )`);
  }

  const chain =
    subordinates.length === 0
      ? null
      : Prisma.sql`(
          ${Prisma.raw(`"${alias}"."authorId"`)} = ANY(${subordinates}::text[])
          AND ${Prisma.raw(`"${alias}"."approvalStatus"`)}::text = ANY(${CHAIN_VISIBLE_STATUSES}::text[])
        )`;

  // Parçalar `OR` ile birleşir. Prisma tarafındaki `clauses` dizisiyle
  // **aynı sırada ve aynı sayıda** olmalı; denklik testi bunu doğruluyor.
  const parcalar = [
    own,
    dokundugu,
    approver,
    ...vekilPencereleri,
    vekilKuyrugu,
    chain,
  ].filter((parca): parca is Prisma.Sql => parca !== null);

  return Prisma.sql`(${Prisma.join(parcalar, " OR ")})`;
}

/**
 * Sistem yöneticisinin müdahale kuyruğundaki tek kayıt biçimi (§8.2).
 * Açıklama ve ekler burada **yoktur** ve eklenemez: tip, sızıntıyı derleme
 * zamanında engeller.
 */
export interface InterventionItem {
  id: string;
  authorId: string;
  authorName: string;
  activityDate: Date;
  title: string;
}

export type InterventionDb = Pick<PrismaClient, "activity">;

/**
 * "Yönetici bulunamadı" kayıtları — yalnızca yönlendirme için gereken üst veri.
 *
 * Ham bir `where` döndürmek yeterli değildi: çağıran istediği alanı
 * seçebildiği için "yalnız üst veri" kuralı sorgu katmanında zorlanmıyordu
 * (denetim 18.08.2026, bulgu 2). Projeksiyon artık burada sabit.
 */
export async function listInterventionQueue(
  db: InterventionDb,
  viewer: Viewer,
  limit = 100,
): Promise<InterventionItem[]> {
  if (!viewer.isSystemAdmin) return [];

  const rows = await db.activity.findMany({
    where: { approvalStatus: "MANAGER_NOT_FOUND" },
    orderBy: { activityDate: "asc" },
    take: limit,
    select: {
      id: true,
      authorId: true,
      activityDate: true,
      title: true,
      author: { select: { fullName: true } },
    },
  });

  return rows.map(({ author, ...row }) => ({ ...row, authorName: author.fullName }));
}
