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

// Demo data: used for installation, admin demo controls, and testing.
// Sets up a comprehensive sample company demonstrating organizational hierarchy,
// activity logging, approval workflows, questions & replies, follow-ups,
// read receipts, absences, and notifications.

export const DEMO_DEFAULT_PASSWORD = "demo-password-1234";

/** Number of business days to generate historical demo activities for. */
const GUN_SAYISI = 12;

export interface InstallOptions {
  /** Password for sample accounts. */
  password?: string;
  /** Logging callback. */
  onLog?: (message: string) => void;
}

export type InstallResult =
  | { ok: true; log: string[] }
  | { ok: false; error: "no_root"; log: string[] };

interface KisiTanimi {
  ad: string;
  eposta: string;
  birim: string;
  unvan?: string;
  yonetici?: boolean;
  yazar?: boolean;
  sistemYoneticisi?: boolean;
  isScored?: boolean;
  canAppreciate?: boolean;
}

const BIRIMLER = [
  { ad: "Board of Directors", ust: "root", tur: "Board", onay: false },
  { ad: "Executive Management", ust: "Board of Directors", tur: "Executive", onay: false },
  {
    ad: "Procurement & Operations",
    ust: "Executive Management",
    tur: "Division",
    onay: false,
  },
  { ad: "Procurement", ust: "Procurement & Operations", tur: "Department", onay: true },
  { ad: "Legal", ust: "Procurement & Operations", tur: "Department", onay: true },
  { ad: "Administration", ust: "Procurement & Operations", tur: "Department", onay: true },
  { ad: "Finance & Accounting", ust: "Executive Management", tur: "Division", onay: false },
  { ad: "Global Finance", ust: "Finance & Accounting", tur: "Department", onay: true },
  { ad: "Accounting", ust: "Finance & Accounting", tur: "Department", onay: true },
  { ad: "Treasury", ust: "Finance & Accounting", tur: "Department", onay: true },
  { ad: "Internal Audit", ust: "Finance & Accounting", tur: "Department", onay: true },
  { ad: "Accounts Receivable", ust: "Finance & Accounting", tur: "Department", onay: true },
  { ad: "Supply Chain & Logistics", ust: "Executive Management", tur: "Division", onay: false },
  { ad: "Information Technology", ust: "Supply Chain & Logistics", tur: "Department", onay: true },
  { ad: "International Trade", ust: "Supply Chain & Logistics", tur: "Department", onay: true },
  { ad: "Warehouse & Shipping", ust: "Supply Chain & Logistics", tur: "Department", onay: true },
  { ad: "Sales & Marketing", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Human Resources", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Quality Assurance", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Sustainability & Safety", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Engineering", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Tooling & Prototyping", ust: "Engineering", tur: "Unit", onay: true },
  { ad: "CNC Machining", ust: "Engineering", tur: "Unit", onay: true },
  { ad: "Product Design", ust: "Engineering", tur: "Unit", onay: true },
  { ad: "Hardware Fabrication", ust: "Engineering", tur: "Unit", onay: true },
  { ad: "Production", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Production Planning", ust: "Executive Management", tur: "Department", onay: true },
  { ad: "Assembly & Quality Control", ust: "Executive Management", tur: "Department", onay: true },
];

const KISILER: KisiTanimi[] = [
  {
    ad: "Board Member",
    eposta: `board@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Board Member",
    birim: "Board of Directors",
    yonetici: true,
    yazar: false,
    isScored: false,
    canAppreciate: true,
  },
  {
    ad: "Alex Morgan",
    eposta: `alex.morgan@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Chief Executive Officer",
    birim: "Executive Management",
    yonetici: true,
    yazar: false,
    isScored: false,
  },
  {
    ad: "Sarah Jenkins",
    eposta: `sarah.jenkins@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Chief Operating Officer",
    birim: "Executive Management",
    yazar: false,
    isScored: false,
  },
  {
    ad: "David Kim",
    eposta: `david.kim@${DEMO_EMAIL_DOMAIN}`,
    unvan: "VP of Procurement & Operations",
    birim: "Procurement & Operations",
    yonetici: true,
  },
  {
    ad: "Emily Watson",
    eposta: `emily.procurement@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Procurement Manager",
    birim: "Procurement",
    yonetici: true,
  },
  {
    ad: "Michael Chen",
    eposta: `michael.legal@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Legal Counsel",
    birim: "Legal",
    yonetici: true,
  },
  {
    ad: "Claire Dupont",
    eposta: `claire.admin@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Administration Manager",
    birim: "Administration",
    yonetici: true,
  },
  {
    ad: "Robert Taylor",
    eposta: `robert.finance@${DEMO_EMAIL_DOMAIN}`,
    unvan: "VP of Finance",
    birim: "Finance & Accounting",
    yonetici: true,
  },
  {
    ad: "Alan Howard",
    eposta: `alan.howard@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Global Finance Director",
    birim: "Global Finance",
    yonetici: true,
  },
  {
    ad: "Jessica Miller",
    eposta: `jessica.accounting@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Accounting Manager",
    birim: "Accounting",
    yonetici: true,
  },
  {
    ad: "Brian Scott",
    eposta: `brian.treasury@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Treasury Manager",
    birim: "Treasury",
    yonetici: true,
  },
  {
    ad: "Melanie Ross",
    eposta: `melanie.audit@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Internal Audit Lead",
    birim: "Internal Audit",
    yonetici: true,
  },
  {
    ad: "Simon Brooks",
    eposta: `simon.receivable@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Accounts Receivable Manager",
    birim: "Accounts Receivable",
    yonetici: true,
  },
  {
    ad: "Lucas Martin",
    eposta: `lucas.logistics@${DEMO_EMAIL_DOMAIN}`,
    unvan: "VP of Supply Chain",
    birim: "Supply Chain & Logistics",
    yonetici: true,
  },
  {
    ad: "Marcus Vance",
    eposta: `marcus.it@${DEMO_EMAIL_DOMAIN}`,
    unvan: "IT Lead & System Administrator",
    birim: "Information Technology",
    yonetici: true,
    sistemYoneticisi: true,
  },
  {
    ad: "Ethan Hunt",
    eposta: `ethan.trade@${DEMO_EMAIL_DOMAIN}`,
    unvan: "International Trade Manager",
    birim: "International Trade",
    yonetici: true,
  },
  {
    ad: "Carlos Ortiz",
    eposta: `carlos.warehouse@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Warehouse & Shipping Manager",
    birim: "Warehouse & Shipping",
    yonetici: true,
  },
  {
    ad: "Sophia Turner",
    eposta: `sophia.sales@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Sales & Marketing Director",
    birim: "Sales & Marketing",
    yonetici: true,
  },
  {
    ad: "Zoe Anderson",
    eposta: `zoe.hr@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Human Resources Director",
    birim: "Human Resources",
    yonetici: true,
  },
  {
    ad: "Liam Walker",
    eposta: `liam.quality@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Quality Assurance Manager",
    birim: "Quality Assurance",
    yonetici: true,
  },
  {
    ad: "Eric Hayes",
    eposta: `eric.sustainability@${DEMO_EMAIL_DOMAIN}`,
    unvan: "EHS & Sustainability Manager",
    birim: "Sustainability & Safety",
    yonetici: true,
  },
  {
    ad: "Kevin Russell",
    eposta: `kevin.engineering@${DEMO_EMAIL_DOMAIN}`,
    unvan: "VP of Engineering",
    birim: "Engineering",
    yonetici: true,
  },
  {
    ad: "Amanda Ross",
    eposta: `amanda.tooling@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Tooling & Prototyping Manager",
    birim: "Tooling & Prototyping",
    yonetici: true,
  },
  {
    ad: "Victor Gomez",
    eposta: `victor.cnc@${DEMO_EMAIL_DOMAIN}`,
    unvan: "CNC Workshop Manager",
    birim: "CNC Machining",
    yonetici: true,
  },
  {
    ad: "Brenda Clark",
    eposta: `brenda.design@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Product Design Lead",
    birim: "Product Design",
    yonetici: true,
  },
  {
    ad: "Tyler Ward",
    eposta: `tyler.fabrication@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Hardware Fabrication Manager",
    birim: "Hardware Fabrication",
    yonetici: true,
  },
  {
    ad: "Leo Patel",
    eposta: `leo.production@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Production Director",
    birim: "Production",
    yonetici: true,
  },
  {
    ad: "Benjamin Baker",
    eposta: `benjamin.planning@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Planning Manager",
    birim: "Production Planning",
    yonetici: true,
  },
  {
    ad: "Samantha King",
    eposta: `samantha.assembly@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Assembly Manager",
    birim: "Assembly & Quality Control",
    yonetici: true,
  },
  {
    ad: "Rachel Cooper",
    eposta: `rachel.procurement@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Procurement Specialist",
    birim: "Procurement",
  },
  {
    ad: "Daniel Brooks",
    eposta: `daniel.accounting@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Senior Accountant",
    birim: "Accounting",
  },
  {
    ad: "Melissa Adams",
    eposta: `melissa.trade@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Trade Compliance Specialist",
    birim: "International Trade",
  },
  {
    ad: "Oliver Wright",
    eposta: `oliver.tooling@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Tooling Technician",
    birim: "Tooling & Prototyping",
  },
  {
    ad: "Justin Green",
    eposta: `justin.planning@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Production Planner",
    birim: "Production Planning",
  },
  {
    ad: "Thomas Reed",
    eposta: `thomas.production@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Manufacturing Operator",
    birim: "Production",
  },
  {
    ad: "Hannah Cole",
    eposta: `hannah.assembly@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Assembly & QC Specialist",
    birim: "Assembly & Quality Control",
  },
  // Inactive user: historical records remain, cannot log in.
  {
    ad: "George Nelson",
    eposta: `george.inactive@${DEMO_EMAIL_DOMAIN}`,
    unvan: "Former Operator",
    birim: "Production",
  },
];

/** Unit names created by demo setup; root unit is excluded. */
export const DEMO_UNIT_NAMES = BIRIMLER.map((birim) => birim.ad);

const FAALIYETLER: Record<string, { baslik: string; aciklama: string }[]> = {
  Procurement: [
    {
      baslik: "Supplier quote comparison",
      aciklama:
        "Compared quotes from three suppliers; delivery lead time and total landed cost were evaluated together.",
    },
    {
      baslik: "Purchase order expediting",
      aciklama:
        "Monitored delivery schedules of open purchase orders; requested updated ETAs for two delayed items.",
    },
  ],
  "Tooling & Prototyping": [
    {
      baslik: "Tooling maintenance inspection",
      aciklama:
        "Dismantled die tooling on press #3, inspected surface wear and cleaned components. Replaced two guide pins.",
    },
    {
      baslik: "Prototype trial run",
      aciklama:
        "Ran initial sample trial with customer tooling; edge burr slightly exceeded tolerance, increasing cooling cycle duration.",
    },
    {
      baslik: "Tooling downtime troubleshooting",
      aciklama:
        "Replaced faulty temperature sensor on injection mold line. Machine stopped for 40 minutes.",
    },
  ],
  "Production Planning": [
    {
      baslik: "Weekly production scheduling",
      aciklama:
        "Updated weekly schedule based on incoming orders; prioritized two urgent work orders pending raw material confirmation.",
    },
    {
      baslik: "Supply delay rescheduling",
      aciklama:
        "Supplier notified one-week shipment delay for critical spare parts; evaluating secondary source alternatives.",
    },
  ],
  Production: [
    {
      baslik: "Shift performance report",
      aciklama:
        "Morning shift achieved 92% of production quota; two short stoppages logged, scrap rate remains within tolerance.",
    },
    {
      baslik: "Quality deviation inspection",
      aciklama:
        "Identified out-of-tolerance deviation on three batch units during dimensional inspection; isolated batch and alerted engineering.",
    },
  ],
  "Warehouse & Shipping": [
    {
      baslik: "Dispatch routing plan",
      aciklama:
        "Organized daily dispatches by carrier and delivery coordinates; confirmed arrival windows with two key clients.",
    },
    {
      baslik: "Cycle count inventory audit",
      aciklama:
        "Performed cycle count on high-turnover SKUs; reconciled discrepancies between WMS and physical shelf counts.",
    },
  ],
  "International Trade": [
    {
      baslik: "Customs documentation audit",
      aciklama:
        "Audited export documents including invoices, packing lists, and certificates of origin; obtained missing verification signature.",
    },
    {
      baslik: "Freight logistics tracking",
      aciklama:
        "Updated overseas carrier tracking status; shared updated arrival estimates with operations teams.",
    },
  ],
  Accounting: [
    {
      baslik: "Accounts payable invoice verification",
      aciklama:
        "Cross-referenced weekly vendor invoices with purchase orders and receiving slips; flagged two invoices for review.",
    },
    {
      baslik: "Balance reconciliation",
      aciklama:
        "Reviewed accounts receivable balances and prepared documentation for month-end reconciliation.",
    },
  ],
  Engineering: [
    {
      baslik: "Production line readiness",
      aciklama:
        "Verified dies, tooling kits, and engineering drawings for today's work order; requested missing fixture from tooling.",
    },
    {
      baslik: "Technical design evaluation",
      aciklama:
        "Investigated dimensional variance on manufactured parts; adjusted machine tooling parameters.",
    },
  ],
  "Executive Management": [
    {
      baslik: "Monthly executive operations review",
      aciklama:
        "Reviewed departmental KPI submissions; assigned owners and resolution deadlines for two high-priority operational bottlenecks.",
    },
  ],
};

/** List of dates working backwards from today, skipping non-business days. */
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

  const eskiDemoKurulumuVar =
    (await db.user.count({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    })) > 0;

  const root = await db.orgUnit.findFirst({ where: { parentId: null } });
  if (!root) {
    return { ok: false as const, error: "no_root" as const, log: satirlar };
  }

  // --- Organizational Units ------------------------------------------------
  const birimler = new Map<string, string>([
    ["root", root.id],
    ["kök", root.id],
  ]);

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
    if (!ustId) throw new Error(`Parent unit not found: ${tanim.ust}`);

    const olusan = await createOrgUnit(db, {
      name: tanim.ad,
      type: tanim.tur,
      parentId: ustId,
      sortOrder: 0,
      requiresApproval: tanim.onay,
      autoFlowsUp: true,
      attentionGroupId: null,
    });

    if (!olusan.ok) throw new Error(`${tanim.ad}: ${olusan.message}`);
    birimler.set(tanim.ad, olusan.value.id);

    await rememberDemoOrgUnitOrigin(db, olusan.value.id, DEMO_ORIGIN_CREATED);
    log(`unit created: ${tanim.ad}`);
  }

  // --- Users ---------------------------------------------------------------
  const kisiler = new Map<
    string,
    {
      id: string;
      orgUnitId: string;
      yoneticiId: string | null;
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
    if (!orgUnitId) throw new Error(`Unit not found: ${tanim.birim}`);

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
    log(`user created: ${tanim.ad}`);
  }

  for (const [index, tanim] of KISILER.entries()) {
    const kisi = kisiler.get(tanim.eposta)!;
    await db.user.updateMany({
      where: { id: kisi.id, lastLoginAt: null },
      data: { lastLoginAt: new Date(now.getTime() - (index + 1) * 86_400_000) },
    });
  }

  // --- Approvers -----------------------------------------------------------
  for (const tanim of KISILER) {
    const kisi = kisiler.get(tanim.eposta)!;
    if (tanim.yonetici) continue;

    const birim = await db.orgUnit.findUnique({
      where: { id: kisi.orgUnitId },
      select: { requiresApproval: true },
    });

    if (!birim?.requiresApproval) continue;

    const yoneticiler = await resolveManagers(db, kisi.id);
    kisi.yoneticiIds = yoneticiler.found ? yoneticiler.managerIds : [];
    kisi.yoneticiId = yoneticiler.found ? (yoneticiler.managerIds[0] ?? null) : null;
  }

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

  // --- Activities ----------------------------------------------------------
  const gunler = sonIsGunleri(now, GUN_SAYISI);
  let yazilan = 0;

  for (const tanim of KISILER) {
    if (tanim.yazar === false) continue;

    const kisi = kisiler.get(tanim.eposta)!;
    const havuz = FAALIYETLER[tanim.birim] ?? FAALIYETLER["Executive Management"];

    for (const [index, gun] of gunler.entries()) {
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

  if (yazilan > 0) log(`${yazilan} activities written`);

  // --- Referenced Departments ----------------------------------------------
  const kalipMudur = kisiler.get(`amanda.tooling@${DEMO_EMAIL_DOMAIN}`)!;
  const uretimId = birimler.get("Production")!;
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

  // --- Conversations -------------------------------------------------------
  const genelMudur = kisiler.get(`alex.morgan@${DEMO_EMAIL_DOMAIN}`)!;
  const mevcutKonusma = await db.conversation.count();

  if (mevcutKonusma === 0 && kalipKayitlari.length >= 2) {
    const acik = await askQuestion(
      db,
      { id: genelMudur.id, isSystemAdmin: false },
      {
        activityId: kalipKayitlari[0].id,
        text: "The wear on this tooling seems recurring; what permanent engineering solution do you propose?",
      },
      now,
    );
    if (acik.ok) log("open conversation added (pending reply)");

    const cevaplanan = await askQuestion(
      db,
      { id: genelMudur.id, isSystemAdmin: false },
      {
        activityId: kalipKayitlari[1].id,
        text: "Which process parameter did you adjust to resolve the edge burr issue?",
      },
      now,
    );

    if (cevaplanan.ok) {
      await replyToConversation(
        db,
        { id: kalipMudur.id, isSystemAdmin: false },
        {
          conversationId: cevaplanan.value.id,
          text: "We extended the cooling cycle duration by two seconds; will verify dimensions on the next trial batch.",
        },
        new Date(now.getTime() + 3_600_000),
      );
      log("replied conversation added");
    }
  }

  // --- Cancelled Activity --------------------------------------------------
  const planlamaci = kisiler.get(`justin.planning@${DEMO_EMAIL_DOMAIN}`)!;
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
            reason: "Entered for incorrect date; replacement entry submitted separately.",
            createdAt: now,
          },
        });
      });
      log("cancelled activity record added");
    }
  }

  // --- Approval Reasons ----------------------------------------------------
  const GEREKCELER = [
    { kind: "CHANGES_REQUESTED" as const, label: "Insufficient description", sortOrder: 1 },
    { kind: "CHANGES_REQUESTED" as const, label: "Incorrect activity date", sortOrder: 2 },
    { kind: "CHANGES_REQUESTED" as const, label: "Missing referenced department", sortOrder: 3 },
    { kind: "REJECTED" as const, label: "Out of scope activity", sortOrder: 1 },
    { kind: "REJECTED" as const, label: "Duplicate entry", sortOrder: 2 },
  ];

  for (const gerekce of GEREKCELER) {
    await db.approvalReason.upsert({
      where: { kind_label: { kind: gerekce.kind, label: gerekce.label } },
      update: {},
      create: gerekce,
    });
  }

  const duzeltmeGerekce = await db.approvalReason.findFirst({
    where: { kind: "CHANGES_REQUESTED", label: "Insufficient description" },
  });
  const retGerekce = await db.approvalReason.findFirst({
    where: { kind: "REJECTED", label: "Duplicate entry" },
  });

  // --- Records in Various Approval States -----------------------------------
  const kalipci = kisiler.get(`oliver.tooling@${DEMO_EMAIL_DOMAIN}`)!;
  const planci = kisiler.get(`justin.planning@${DEMO_EMAIL_DOMAIN}`)!;
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
    "Daily press line inspection",
    "Completed daily oil and pressure checks across three presses; two within range, one recorded low pressure.",
    "PENDING_APPROVAL",
    null,
    null,
    null,
  );
  await kararliKayit(
    planci,
    "Order prioritization update",
    "Added three urgent customer orders to the line schedule.",
    "CHANGES_REQUESTED",
    duzeltmeGerekce?.id ?? null,
    duzeltmeGerekce ? "CHANGES_REQUESTED" : null,
    "Please specify which orders were prioritized and which work orders were rescheduled.",
  );
  await kararliKayit(
    planci,
    "Order prioritization update (duplicate)",
    "Duplicate entry for work order schedule.",
    "REJECTED",
    retGerekce?.id ?? null,
    retGerekce ? "REJECTED" : null,
    "Identical entry has already been recorded for this date.",
  );
  log("records added for all four approval states");

  // --- Follow-Up Items -----------------------------------------------------
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
      const taze = await openFollowUp(
        db,
        genelMudurViewer,
        {
          activityId: adaylar[0].id,
          nextStep: "Obtain written delivery confirmation from supplier.",
        },
        now,
      );
      if (taze.ok) log("open follow-up item added");

      const kalipKaydi = await activityMaintenanceReader(db).findFirst({
        where: { authorId: kalipci.id, approvalStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      const eski = kalipKaydi
        ? await openFollowUp(
            db,
            genelMudurViewer,
            {
              activityId: kalipKaydi.id,
              nextStep: "Perform engineering evaluation for permanent solution.",
              ownerId: kalipMudur.id,
            },
            now,
          )
        : ({ ok: false } as const);

      if (eski.ok) {
        const geriye = new Date(now.getTime() - 20 * 24 * 3_600_000);
        await db.followUpItem.update({
          where: { id: eski.item.id },
          data: { openedAt: geriye, lastMovedAt: geriye, createdAt: geriye },
        });
        log("stale follow-up item added");
      }

      const kapanacak = await openFollowUp(
        db,
        genelMudurViewer,
        {
          activityId: adaylar[2].id,
          nextStep: "Place order for replacement spare parts.",
        },
        now,
      );

      if (kapanacak.ok) {
        await closeFollowUp(
          db,
          genelMudurViewer,
          kapanacak.item.id,
          "Replacement part received and installed; issue resolved.",
          now,
        );
        log("closed follow-up item added");
      }
    }
  }

  // --- Read Receipts -------------------------------------------------------
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
  log(`${okunanlar.length} activities marked as read for CEO`);

  // --- Calendar: Holidays --------------------------------------------------
  const yil = Number(bugun.slice(0, 4));
  const TATILLER = [
    { tarih: `${yil}-01-01`, ad: "New Year's Day" },
    { tarih: `${yil}-04-20`, ad: "Spring Holiday" },
    { tarih: `${yil}-05-01`, ad: "Labor Day" },
    { tarih: `${yil}-07-04`, ad: "Mid-Year Break" },
    { tarih: `${yil}-10-12`, ad: "Autumn Holiday" },
    { tarih: `${yil}-12-25`, ad: "Winter Holiday" },
  ];

  for (const tatil of TATILLER) {
    await db.holiday.upsert({
      where: { date: toDateValue(tatil.tarih) },
      update: {},
      create: { date: toDateValue(tatil.tarih), description: tatil.ad },
    });
  }
  log(`${TATILLER.length} holidays added to calendar`);

  // --- Help Articles -------------------------------------------------------
  const YARDIM_YAZILARI = [
    {
      category: "Getting Started",
      title: "What should I do after my first login?",
      answer:
        "Start by checking the Today dashboard. Here you will see your pending actions, approval queues, and a daily overview. To record your work, navigate to My Activities and click New Activity.\n\nYou can also update your notification preferences and profile details under My Profile.",
    },
    {
      category: "Activities",
      title: "How do I submit an activity log?",
      answer:
        "Open My Activities, click New Activity, and fill in the title and description. Keep the title concise and provide sufficient context in the description so team members can understand the work.\n\nIf your unit requires approval, the activity will be routed to your manager. You can view its status in your activity list until approved.",
    },
    {
      category: "Absences",
      title: "What is a no-activity period?",
      answer:
        "If you are on leave, holiday, or otherwise excused from daily activity logging, record this period under My Absences. Once approved, activity reminders are paused and the days are excluded from attendance metrics.\n\nEmployee requests require manager approval, whereas manager submissions take effect immediately.",
    },
    {
      category: "Managers",
      title: "How do I process absence requests from my team?",
      answer:
        "Open the Team section. You will see requests submitted by members of your department. Review the dates and note, then click Approve or Reject.\n\nWhen rejecting, provide a brief reason so the employee knows what adjustments are needed.",
    },
    {
      category: "Notifications",
      title: "How can I customize my notification preferences?",
      answer:
        "System administrators configure global notification events and channels. As an individual user, you can set your email preferences to instant alerts, a daily digest, or action-required only under My Profile.\n\nSecurity emails such as password resets are always delivered immediately.",
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

    const sonuc = await createHelpArticle(
      db,
      genelMudur.id,
      {
        ...yazi,
        sortOrder: index,
        isPublished: true,
      },
      now,
    );
    if (!sonuc.ok) throw new Error(`${yazi.title}: ${sonuc.message}`);
    eklenenYardim += 1;
  }
  if (eklenenYardim > 0) log(`${eklenenYardim} help articles added`);

  // --- Absence Records -----------------------------------------------------
  const izinVar = await db.noActivityPeriod.count();
  if (izinVar === 0) {
    const izinli = kisiler.get(`hannah.assembly@${DEMO_EMAIL_DOMAIN}`);
    const montajMudur = kisiler.get(`samantha.assembly@${DEMO_EMAIL_DOMAIN}`);

    if (izinli && montajMudur) {
      const baslangic = new Date(now.getTime() - 2 * 24 * 3_600_000);
      const bitis = new Date(now.getTime() + 3 * 24 * 3_600_000);

      await db.noActivityPeriod.create({
        data: {
          userId: izinli.id,
          startDate: toDateValue(companyDay(baslangic)),
          endDate: toDateValue(companyDay(bitis)),
          note: "Annual leave",
          markedById: montajMudur.id,
          status: "APPROVED",
          decidedAt: now,
          decidedById: montajMudur.id,
        },
      });
      log("absence record added");
    }
  }

  const nazli = kisiler.get(`board@${DEMO_EMAIL_DOMAIN}`);
  const kalipciCalisan = kisiler.get(`oliver.tooling@${DEMO_EMAIL_DOMAIN}`);

  if (nazli) {
    const not = "Example: approved by executive";
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
      if (!sonuc.ok) throw new Error(`Board demo absence: ${sonuc.message}`);
      log("approved absence example added for Board member");
    }
  }

  // Sample appreciation by Board member
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
      log("sample appreciation added by Board member");
    }
  }

  if (kalipciCalisan && kalipMudur) {
    const bekleyenNot = "Example: pending manager approval";
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
      if (!sonuc.ok) throw new Error(`Pending absence example: ${sonuc.message}`);
      log("pending absence request added");
    }

    const reddedilenNot = "Example: rejected absence request";
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
      if (!sonuc.ok) throw new Error(`Rejected absence example: ${sonuc.message}`);
      reddedilen = { id: sonuc.id, status: sonuc.status };
    }
    if (reddedilen.status === "PENDING") {
      const sonuc = await decideNoActivityPeriod(
        db,
        kalipMudur.id,
        reddedilen.id,
        "REJECTED",
        "Review dates and resubmit with updated coverage plan.",
        now,
      );
      if (!sonuc.ok) throw new Error(`Rejected absence example: ${sonuc.message}`);
      log("rejected absence request added");
    }
  }

  // --- Deputy Example ------------------------------------------------------
  const vekaletVar = await db.noActivityPeriod.count({
    where: { deputyId: { not: null } },
  });

  if (vekaletVar === 0) {
    const teknikMudurVekaleti = kisiler.get(`kevin.engineering@${DEMO_EMAIL_DOMAIN}`);
    const vekil = kisiler.get(`amanda.tooling@${DEMO_EMAIL_DOMAIN}`);
    const genelMudurVekalet = kisiler.get(`alex.morgan@${DEMO_EMAIL_DOMAIN}`);

    if (teknikMudurVekaleti && vekil && genelMudurVekalet) {
      const vBas = new Date(now.getTime() - 1 * 24 * 3_600_000);
      const vBit = new Date(now.getTime() + 4 * 24 * 3_600_000);

      await db.noActivityPeriod.create({
        data: {
          userId: teknikMudurVekaleti.id,
          startDate: toDateValue(companyDay(vBas)),
          endDate: toDateValue(companyDay(vBit)),
          note: "Annual leave — Tooling Manager acting as deputy",
          deputyId: vekil.id,
          markedById: genelMudurVekalet.id,
        },
      });
      log("deputy example added (Engineering → Tooling Manager)");
    }
  }

  // --- Inactive User -------------------------------------------------------
  const ayrilan = kisiler.get(`george.inactive@${DEMO_EMAIL_DOMAIN}`);
  if (ayrilan) {
    await db.user.update({
      where: { id: ayrilan.id },
      data: { isActive: false },
    });
  }

  // --- Notifications -------------------------------------------------------
  const bildirimVar = await db.notificationQueue.count({
    where: { idempotencyKey: { startsWith: "demo-data:" } },
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
          idempotencyKey: `demo-data:${bildirim.eventType}:${sira}`,
          status: "SENT",
          sentAt: olusma,
          seenAt: bildirim.gorulmus ? olusma : null,
          createdAt: olusma,
        },
      });
    }

    if (bildirimler.length > 0) log(`${bildirimler.length} notifications added`);
  }

  log("ready.");
  return { ok: true as const, log: satirlar };
}
