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
const BUSINESS_DAY_COUNT = 12;

export interface InstallOptions {
  /** Password for sample accounts. */
  password?: string;
  /** Logging callback. */
  onLog?: (message: string) => void;
}

export type InstallResult =
  | { ok: true; log: string[] }
  | { ok: false; error: "no_root"; log: string[] };

interface EmployeeDefinition {
  name: string;
  email: string;
  unit: string;
  title?: string;
  isManager?: boolean;
  isAuthor?: boolean;
  isSystemAdmin?: boolean;
  isScored?: boolean;
  canAppreciate?: boolean;
}

const DEMO_UNITS = [
  { name: "Board of Directors", parent: "root", type: "Board", requiresApproval: false },
  { name: "Executive Management", parent: "Board of Directors", type: "Executive", requiresApproval: false },
  {
    name: "Procurement & Operations",
    parent: "Executive Management",
    type: "Division",
    requiresApproval: false,
  },
  { name: "Procurement", parent: "Procurement & Operations", type: "Department", requiresApproval: true },
  { name: "Legal", parent: "Procurement & Operations", type: "Department", requiresApproval: true },
  { name: "Administration", parent: "Procurement & Operations", type: "Department", requiresApproval: true },
  { name: "Finance & Accounting", parent: "Executive Management", type: "Division", requiresApproval: false },
  { name: "Global Finance", parent: "Finance & Accounting", type: "Department", requiresApproval: true },
  { name: "Accounting", parent: "Finance & Accounting", type: "Department", requiresApproval: true },
  { name: "Treasury", parent: "Finance & Accounting", type: "Department", requiresApproval: true },
  { name: "Internal Audit", parent: "Finance & Accounting", type: "Department", requiresApproval: true },
  { name: "Accounts Receivable", parent: "Finance & Accounting", type: "Department", requiresApproval: true },
  { name: "Supply Chain & Logistics", parent: "Executive Management", type: "Division", requiresApproval: false },
  { name: "Information Technology", parent: "Supply Chain & Logistics", type: "Department", requiresApproval: true },
  { name: "International Trade", parent: "Supply Chain & Logistics", type: "Department", requiresApproval: true },
  { name: "Warehouse & Shipping", parent: "Supply Chain & Logistics", type: "Department", requiresApproval: true },
  { name: "Sales & Marketing", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Human Resources", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Quality Assurance", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Sustainability & Safety", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Engineering", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Tooling & Prototyping", parent: "Engineering", type: "Unit", requiresApproval: true },
  { name: "CNC Machining", parent: "Engineering", type: "Unit", requiresApproval: true },
  { name: "Product Design", parent: "Engineering", type: "Unit", requiresApproval: true },
  { name: "Hardware Fabrication", parent: "Engineering", type: "Unit", requiresApproval: true },
  { name: "Production", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Production Planning", parent: "Executive Management", type: "Department", requiresApproval: true },
  { name: "Assembly & Quality Control", parent: "Executive Management", type: "Department", requiresApproval: true },
];

const DEMO_USERS: EmployeeDefinition[] = [
  {
    name: "Board Member",
    email: `board@${DEMO_EMAIL_DOMAIN}`,
    title: "Board Member",
    unit: "Board of Directors",
    isManager: true,
    isAuthor: false,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Alex Morgan",
    email: `alex.morgan@${DEMO_EMAIL_DOMAIN}`,
    title: "Chief Executive Officer",
    unit: "Executive Management",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Marcus Vance",
    email: `marcus.operations@${DEMO_EMAIL_DOMAIN}`,
    title: "Head of Operations & Procurement",
    unit: "Procurement & Operations",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Emily Watson",
    email: `emily.procurement@${DEMO_EMAIL_DOMAIN}`,
    title: "Procurement Manager",
    unit: "Procurement",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: false,
  },
  {
    name: "Rachel Hayes",
    email: `rachel.procurement@${DEMO_EMAIL_DOMAIN}`,
    title: "Procurement Specialist",
    unit: "Procurement",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Nathan Drake",
    email: `nathan.legal@${DEMO_EMAIL_DOMAIN}`,
    title: "Senior Legal Counsel",
    unit: "Legal",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Laura Croft",
    email: `laura.admin@${DEMO_EMAIL_DOMAIN}`,
    title: "Administrative Affairs Manager",
    unit: "Administration",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Arthur Pendelton",
    email: `arthur.cfo@${DEMO_EMAIL_DOMAIN}`,
    title: "Chief Financial Officer",
    unit: "Finance & Accounting",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Sophia Martinez",
    email: `sophia.finance@${DEMO_EMAIL_DOMAIN}`,
    title: "Global Finance Manager",
    unit: "Global Finance",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "David Sterling",
    email: `david.accounting@${DEMO_EMAIL_DOMAIN}`,
    title: "Accounting Manager",
    unit: "Accounting",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Daniel Craig",
    email: `daniel.accounting@${DEMO_EMAIL_DOMAIN}`,
    title: "Financial Accountant",
    unit: "Accounting",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Chloe Sullivan",
    email: `chloe.treasury@${DEMO_EMAIL_DOMAIN}`,
    title: "Treasury Manager",
    unit: "Treasury",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Victor Stone",
    email: `victor.audit@${DEMO_EMAIL_DOMAIN}`,
    title: "Internal Audit Lead",
    unit: "Internal Audit",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Grace Hopper",
    email: `grace.receivables@${DEMO_EMAIL_DOMAIN}`,
    title: "Accounts Receivable Lead",
    unit: "Accounts Receivable",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Lucas Scott",
    email: `lucas.logistics@${DEMO_EMAIL_DOMAIN}`,
    title: "Head of Supply Chain & Logistics",
    unit: "Supply Chain & Logistics",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Dennis Ritchie",
    email: `dennis.it@${DEMO_EMAIL_DOMAIN}`,
    title: "IT Director & System Admin",
    unit: "Information Technology",
    isManager: true,
    isSystemAdmin: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Maria Santos",
    email: `maria.trade@${DEMO_EMAIL_DOMAIN}`,
    title: "International Trade Lead",
    unit: "International Trade",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Carlos Mendoza",
    email: `carlos.trade@${DEMO_EMAIL_DOMAIN}`,
    title: "Export Logistics Specialist",
    unit: "International Trade",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Alan Border",
    email: `alan.warehouse@${DEMO_EMAIL_DOMAIN}`,
    title: "Warehouse & Shipping Manager",
    unit: "Warehouse & Shipping",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Brian O'Conner",
    email: `brian.warehouse@${DEMO_EMAIL_DOMAIN}`,
    title: "Inventory Logistics Clerk",
    unit: "Warehouse & Shipping",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Sarah Jenkins",
    email: `sarah.marketing@${DEMO_EMAIL_DOMAIN}`,
    title: "Sales & Marketing Director",
    unit: "Sales & Marketing",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Jessica Pearson",
    email: `jessica.hr@${DEMO_EMAIL_DOMAIN}`,
    title: "Human Resources Director",
    unit: "Human Resources",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Peter Parker",
    email: `peter.qa@${DEMO_EMAIL_DOMAIN}`,
    title: "Quality Assurance Lead",
    unit: "Quality Assurance",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Emma Watson",
    email: `emma.safety@${DEMO_EMAIL_DOMAIN}`,
    title: "HSE & Sustainability Officer",
    unit: "Sustainability & Safety",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Kevin Flynn",
    email: `kevin.engineering@${DEMO_EMAIL_DOMAIN}`,
    title: "Chief Technology Officer",
    unit: "Engineering",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Amanda Clark",
    email: `amanda.tooling@${DEMO_EMAIL_DOMAIN}`,
    title: "Tooling & Prototyping Lead",
    unit: "Tooling & Prototyping",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Oliver Queen",
    email: `oliver.tooling@${DEMO_EMAIL_DOMAIN}`,
    title: "Tooling Technician",
    unit: "Tooling & Prototyping",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Barry Allen",
    email: `barry.machining@${DEMO_EMAIL_DOMAIN}`,
    title: "CNC Machining Specialist",
    unit: "CNC Machining",
    isManager: true,
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Diana Prince",
    email: `diana.design@${DEMO_EMAIL_DOMAIN}`,
    title: "Principal Product Designer",
    unit: "Product Design",
    isManager: true,
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Tony Stark",
    email: `tony.fabrication@${DEMO_EMAIL_DOMAIN}`,
    title: "Hardware Fabrication Engineer",
    unit: "Hardware Fabrication",
    isManager: true,
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Walter White",
    email: `walter.production@${DEMO_EMAIL_DOMAIN}`,
    title: "Production Director",
    unit: "Production",
    isManager: true,
    isAuthor: true,
    isScored: false,
    canAppreciate: true,
  },
  {
    name: "Jesse Pinkman",
    email: `jesse.production@${DEMO_EMAIL_DOMAIN}`,
    title: "Shift Production Supervisor",
    unit: "Production",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Justin Case",
    email: `justin.planning@${DEMO_EMAIL_DOMAIN}`,
    title: "Lead Production Planner",
    unit: "Production Planning",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Samantha Wright",
    email: `samantha.assembly@${DEMO_EMAIL_DOMAIN}`,
    title: "Assembly & QC Manager",
    unit: "Assembly & Quality Control",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "Hannah Abbott",
    email: `hannah.assembly@${DEMO_EMAIL_DOMAIN}`,
    title: "Assembly Line Inspector",
    unit: "Assembly & Quality Control",
    isAuthor: true,
    isScored: true,
  },
  {
    name: "Ethan Hunt",
    email: `ethan.secondmgr@${DEMO_EMAIL_DOMAIN}`,
    title: "Deputy Assembly Manager",
    unit: "Assembly & Quality Control",
    isManager: true,
    isAuthor: true,
    isScored: false,
  },
  {
    name: "George Nelson",
    email: `george.inactive@${DEMO_EMAIL_DOMAIN}`,
    title: "Former Operator",
    unit: "Production",
  },
];

/** Unit names created by demo setup; root unit is excluded. */
export const DEMO_UNIT_NAMES = DEMO_UNITS.map((unit) => unit.name);

const DEMO_ACTIVITIES: Record<string, { title: string; description: string }[]> = {
  Procurement: [
    {
      title: "Supplier quote comparison",
      description:
        "Compared quotes from three suppliers; delivery lead time and total landed cost were evaluated together.",
    },
    {
      title: "Purchase order expediting",
      description:
        "Monitored delivery schedules of open purchase orders; requested updated ETAs for two delayed items.",
    },
  ],
  "Tooling & Prototyping": [
    {
      title: "Tooling maintenance inspection",
      description:
        "Dismantled die tooling on press #3, inspected surface wear and cleaned components. Replaced two guide pins.",
    },
    {
      title: "Prototype trial run",
      description:
        "Ran initial sample trial with customer tooling; edge burr slightly exceeded tolerance, increasing cooling cycle duration.",
    },
    {
      title: "Tooling downtime troubleshooting",
      description:
        "Replaced faulty temperature sensor on injection mold line. Machine stopped for 40 minutes.",
    },
  ],
  "Production Planning": [
    {
      title: "Weekly production scheduling",
      description:
        "Updated weekly schedule based on incoming orders; prioritized two urgent work orders pending raw material confirmation.",
    },
    {
      title: "Supply delay rescheduling",
      description:
        "Supplier notified one-week shipment delay for critical spare parts; evaluating secondary source alternatives.",
    },
  ],
  Production: [
    {
      title: "Shift performance report",
      description:
        "Morning shift achieved 92% of production quota; two short stoppages logged, scrap rate remains within tolerance.",
    },
    {
      title: "Quality deviation inspection",
      description:
        "Identified out-of-tolerance deviation on three batch units during dimensional inspection; isolated batch and alerted engineering.",
    },
  ],
  "Warehouse & Shipping": [
    {
      title: "Dispatch routing plan",
      description:
        "Organized daily dispatches by carrier and delivery coordinates; confirmed arrival windows with two key clients.",
    },
    {
      title: "Cycle count inventory audit",
      description:
        "Performed cycle count on high-turnover SKUs; reconciled discrepancies between WMS and physical shelf counts.",
    },
  ],
  "International Trade": [
    {
      title: "Customs documentation audit",
      description:
        "Audited export documents including invoices, packing lists, and certificates of origin; obtained missing verification signature.",
    },
    {
      title: "Freight logistics tracking",
      description:
        "Updated overseas carrier tracking status; shared updated arrival estimates with operations teams.",
    },
  ],
  Accounting: [
    {
      title: "Accounts payable invoice verification",
      description:
        "Cross-referenced weekly vendor invoices with purchase orders and receiving slips; flagged two invoices for review.",
    },
    {
      title: "Balance reconciliation",
      description:
        "Reviewed accounts receivable balances and prepared documentation for month-end reconciliation.",
    },
  ],
  Engineering: [
    {
      title: "Production line readiness",
      description:
        "Verified dies, tooling kits, and engineering drawings for today's work order; requested missing fixture from tooling.",
    },
    {
      title: "Technical design evaluation",
      description:
        "Investigated dimensional variance on manufactured parts; adjusted machine tooling parameters.",
    },
  ],
  "Executive Management": [
    {
      title: "Monthly executive operations review",
      description:
        "Reviewed departmental KPI submissions; assigned owners and resolution deadlines for two high-priority operational bottlenecks.",
    },
  ],
};

/** List of dates working backwards from today, skipping non-business days. */
function recentBusinessDays(now: Date, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${companyDay(now)}T00:00:00.000Z`);

  while (days.length < count) {
    const day = cursor.toISOString().slice(0, 10);
    if (isBusinessDay(day)) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return days.reverse();
}

export async function installDemoData(
  db: PrismaClient,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const password = options.password ?? DEMO_DEFAULT_PASSWORD;
  const now = new Date();
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
    options.onLog?.(message);
  };

  const hasExistingDemoData =
    (await db.user.count({
      where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    })) > 0;

  const root = await db.orgUnit.findFirst({ where: { parentId: null } });
  if (!root) {
    return { ok: false as const, error: "no_root" as const, log: logs };
  }

  // --- Organizational Units ------------------------------------------------
  const units = new Map<string, string>([
    ["root", root.id],
  ]);

  for (const def of DEMO_UNITS) {
    const existing = await db.orgUnit.findFirst({ where: { name: def.name } });
    if (existing) {
      units.set(def.name, existing.id);
      if (!hasExistingDemoData) {
        await rememberDemoOrgUnitOrigin(db, existing.id, DEMO_ORIGIN_REUSED);
      }
      continue;
    }

    const parentId = units.get(def.parent);
    if (!parentId) throw new Error(`Parent unit not found: ${def.parent}`);

    const created = await createOrgUnit(db, {
      name: def.name,
      type: def.type,
      parentId,
      sortOrder: 0,
      requiresApproval: def.requiresApproval,
      autoFlowsUp: true,
      attentionGroupId: null,
    });

    if (!created.ok) throw new Error(`${def.name}: ${created.message}`);
    units.set(def.name, created.value.id);

    await rememberDemoOrgUnitOrigin(db, created.value.id, DEMO_ORIGIN_CREATED);
    log(`unit created: ${def.name}`);
  }

  // --- Users ---------------------------------------------------------------
  const employees = new Map<
    string,
    {
      id: string;
      orgUnitId: string;
      managerId: string | null;
      managerIds: string[];
    }
  >();

  for (const def of DEMO_USERS) {
    const existing = await db.user.findUnique({ where: { email: def.email } });
    if (existing) {
      employees.set(def.email, {
        id: existing.id,
        orgUnitId: existing.orgUnitId,
        managerId: null,
        managerIds: [],
      });
      continue;
    }

    const orgUnitId = units.get(def.unit);
    if (!orgUnitId) throw new Error(`Unit not found: ${def.unit}`);

    const result = await createUser(db, {
      fullName: def.name,
      email: def.email,
      orgUnitId,
      title: def.title ?? null,
      isUnitManager: def.isManager ?? false,
      isSystemAdmin: def.isSystemAdmin ?? false,
      writesActivities: def.isAuthor ?? true,
      isScored: def.isScored ?? true,
      canAppreciate: def.canAppreciate ?? false,
      initialPassword: password,
    });

    if (!result.ok) throw new Error(`${def.email}: ${result.message}`);
    employees.set(def.email, {
      id: result.user.id,
      orgUnitId,
      managerId: null,
      managerIds: [],
    });
    log(`user created: ${def.name}`);
  }

  for (const [index, def] of DEMO_USERS.entries()) {
    const employee = employees.get(def.email)!;
    await db.user.updateMany({
      where: { id: employee.id, lastLoginAt: null },
      data: { lastLoginAt: new Date(now.getTime() - (index + 1) * 86_400_000) },
    });
  }

  // --- Approvers -----------------------------------------------------------
  for (const def of DEMO_USERS) {
    const employee = employees.get(def.email)!;
    if (def.isManager) continue;

    const unit = await db.orgUnit.findUnique({
      where: { id: employee.orgUnitId },
      select: { requiresApproval: true },
    });

    if (!unit?.requiresApproval) continue;

    const managers = await resolveManagers(db, employee.id);
    employee.managerIds = managers.found ? managers.managerIds : [];
    employee.managerId = managers.found ? (managers.managerIds[0] ?? null) : null;
  }

  async function setupApprovalRelations(record: {
    id: string;
    approvalStatus: string;
    approverId: string | null;
    approvalSubmittedAt: Date | null;
    approvalDecidedAt: Date | null;
    approverIds: string[];
  }): Promise<void> {
    if (record.approverIds.length === 0) return;

    for (const userId of record.approverIds) {
      await db.activityApprover.upsert({
        where: { activityId_userId: { activityId: record.id, userId } },
        update: {},
        create: { activityId: record.id, userId },
      });
    }

    const submittedAt = record.approvalSubmittedAt ?? record.approvalDecidedAt;
    if (!submittedAt) return;

    const existingRound = await db.approvalRound.findFirst({
      where: { activityId: record.id },
      select: { id: true },
    });
    if (existingRound) return;

    const isDecided =
      record.approvalStatus !== "PENDING_APPROVAL" && record.approvalDecidedAt !== null;

    await db.approvalRound.create({
      data: {
        activityId: record.id,
        roundNo: 1,
        submittedAt,
        ...(isDecided
          ? {
              decidedAt: record.approvalDecidedAt,
              decidedById: record.approverId,
              decision:
                record.approvalStatus === "APPROVED"
                  ? ("APPROVED" as const)
                  : record.approvalStatus === "REJECTED"
                    ? ("REJECTED" as const)
                    : ("CHANGES_REQUESTED" as const),
            }
          : {}),
      },
    });
  }

  // --- Activities ----------------------------------------------------------
  const days = recentBusinessDays(now, BUSINESS_DAY_COUNT);
  let writtenCount = 0;

  for (const def of DEMO_USERS) {
    if (def.isAuthor === false) continue;

    const employee = employees.get(def.email)!;
    const pool = DEMO_ACTIVITIES[def.unit] ?? DEMO_ACTIVITIES["Executive Management"];

    for (const [index, day] of days.entries()) {
      if ((index + def.email.length) % 4 === 0) continue;

      const template = pool[index % pool.length];
      const title = `${template.title} — ${day.slice(5)}`;

      const existing = await activityMaintenanceReader(db).findFirst({
        where: { authorId: employee.id, title },
        select: {
          id: true,
          approvalStatus: true,
          approverId: true,
          approvalSubmittedAt: true,
          approvalDecidedAt: true,
        },
      });
      if (existing) {
        await setupApprovalRelations({ ...existing, approverIds: employee.managerIds });
        continue;
      }

      const createdAt = new Date(`${day}T14:00:00.000Z`);
      const created = await db.activity.create({
        data: {
          authorId: employee.id,
          authorOrgUnitId: employee.orgUnitId,
          activityDate: toDateValue(day),
          title,
          description: template.description,
          approvalStatus: "APPROVED",
          approverId: employee.managerId,
          approvalSubmittedAt: employee.managerId ? createdAt : null,
          approvalDecidedAt: employee.managerId ? createdAt : null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      await setupApprovalRelations({
        id: created.id,
        approvalStatus: created.approvalStatus,
        approverId: created.approverId,
        approvalSubmittedAt: created.approvalSubmittedAt,
        approvalDecidedAt: created.approvalDecidedAt,
        approverIds: employee.managerIds,
      });

      await db.activityRevision.create({
        data: {
          activityId: created.id,
          revisionNo: 1,
          title,
          description: template.description,
          targetOrgUnitIds: [],
          changedById: employee.id,
          createdAt,
        },
      });
      writtenCount += 1;
    }
  }

  if (writtenCount > 0) log(`${writtenCount} activities written`);

  // --- Referenced Departments ----------------------------------------------
  const toolingManager = employees.get(`amanda.tooling@${DEMO_EMAIL_DOMAIN}`)!;
  const productionId = units.get("Production")!;
  const toolingActivities = await activityMaintenanceReader(db).findMany({
    where: { authorId: toolingManager.id },
    select: { id: true },
    take: 3,
  });

  for (const activity of toolingActivities) {
    await db.activityTargetDept.createMany({
      data: [{ activityId: activity.id, orgUnitId: productionId }],
      skipDuplicates: true,
    });
  }

  // --- Conversations -------------------------------------------------------
  const ceo = employees.get(`alex.morgan@${DEMO_EMAIL_DOMAIN}`)!;
  const existingConversations = await db.conversation.count();

  if (existingConversations === 0 && toolingActivities.length >= 2) {
    const openQuestion = await askQuestion(
      db,
      { id: ceo.id, isSystemAdmin: false },
      {
        activityId: toolingActivities[0].id,
        text: "The wear on this tooling seems recurring; what permanent engineering solution do you propose?",
      },
      now,
    );
    if (openQuestion.ok) log("open conversation added (pending reply)");

    const repliedQuestion = await askQuestion(
      db,
      { id: ceo.id, isSystemAdmin: false },
      {
        activityId: toolingActivities[1].id,
        text: "Which process parameter did you adjust to resolve the edge burr issue?",
      },
      now,
    );

    if (repliedQuestion.ok) {
      await replyToConversation(
        db,
        { id: toolingManager.id, isSystemAdmin: false },
        {
          conversationId: repliedQuestion.value.id,
          text: "We extended the cooling cycle duration by two seconds; will verify dimensions on the next trial batch.",
        },
        new Date(now.getTime() + 3_600_000),
      );
      log("replied conversation added");
    }
  }

  // --- Cancelled Activity --------------------------------------------------
  const planner = employees.get(`justin.planning@${DEMO_EMAIL_DOMAIN}`)!;
  const activityToCancel = await activityMaintenanceReader(db).findFirst({
    where: { authorId: planner.id, approvalStatus: "APPROVED" },
    select: { id: true },
  });

  if (activityToCancel) {
    const alreadyCancelled = await db.cancellationRecord.count({
      where: { activityId: activityToCancel.id },
    });

    if (alreadyCancelled === 0) {
      await db.$transaction(async (tx) => {
        await tx.activity.update({
          where: { id: activityToCancel.id },
          data: { approvalStatus: "CANCELLED" },
        });
        await tx.cancellationRecord.create({
          data: {
            activityId: activityToCancel.id,
            cancelledById: planner.id,
            reason: "Entered for incorrect date; replacement entry submitted separately.",
            createdAt: now,
          },
        });
      });
      log("cancelled activity record added");
    }
  }

  // --- Approval Reasons ----------------------------------------------------
  const APPROVAL_REASONS = [
    { kind: "CHANGES_REQUESTED" as const, label: "Insufficient description", sortOrder: 1 },
    { kind: "CHANGES_REQUESTED" as const, label: "Incorrect activity date", sortOrder: 2 },
    { kind: "CHANGES_REQUESTED" as const, label: "Missing referenced department", sortOrder: 3 },
    { kind: "REJECTED" as const, label: "Out of scope activity", sortOrder: 1 },
    { kind: "REJECTED" as const, label: "Duplicate entry", sortOrder: 2 },
  ];

  for (const reason of APPROVAL_REASONS) {
    await db.approvalReason.upsert({
      where: { kind_label: { kind: reason.kind, label: reason.label } },
      update: {},
      create: reason,
    });
  }

  const changesRequestedReason = await db.approvalReason.findFirst({
    where: { kind: "CHANGES_REQUESTED", label: "Insufficient description" },
  });
  const rejectedReason = await db.approvalReason.findFirst({
    where: { kind: "REJECTED", label: "Duplicate entry" },
  });

  // --- Records in Various Approval States -----------------------------------
  const toolingEmployee = employees.get(`oliver.tooling@${DEMO_EMAIL_DOMAIN}`)!;
  const planningEmployee = employees.get(`justin.planning@${DEMO_EMAIL_DOMAIN}`)!;
  const todayStr = companyDay(now);

  async function createDecidedActivity(
    author: {
      id: string;
      orgUnitId: string;
      managerId: string | null;
      managerIds: string[];
    },
    title: string,
    description: string,
    status: "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "REJECTED",
    reasonId: string | null,
    reasonKind: "CHANGES_REQUESTED" | "REJECTED" | null,
    note: string | null,
  ): Promise<string | null> {
    const existing = await activityMaintenanceReader(db).findFirst({
      where: { authorId: author.id, title },
      select: {
        id: true,
        approvalStatus: true,
        approverId: true,
        approvalSubmittedAt: true,
        approvalDecidedAt: true,
      },
    });
    if (existing) {
      await setupApprovalRelations({ ...existing, approverIds: author.managerIds });
      return existing.id;
    }
    if (!author.managerId) return null;

    const activity = await db.activity.create({
      data: {
        authorId: author.id,
        authorOrgUnitId: author.orgUnitId,
        activityDate: toDateValue(todayStr),
        title,
        description,
        approvalStatus: status,
        approverId: author.managerId,
        approvalSubmittedAt: now,
        approvalDecidedAt: status === "PENDING_APPROVAL" ? null : now,
        approvalReasonId: reasonId,
        approvalReasonKind: reasonKind,
        approvalReasonNote: note,
      },
    });

    await db.activityRevision.create({
      data: {
        activityId: activity.id,
        revisionNo: 1,
        title,
        description,
        targetOrgUnitIds: [],
        changedById: author.id,
      },
    });

    await setupApprovalRelations({
      id: activity.id,
      approvalStatus: status,
      approverId: author.managerId,
      approvalSubmittedAt: now,
      approvalDecidedAt: status === "PENDING_APPROVAL" ? null : now,
      approverIds: author.managerIds,
    });

    return activity.id;
  }

  await createDecidedActivity(
    toolingEmployee,
    "Daily press line inspection",
    "Completed daily oil and pressure checks across three presses; two within range, one recorded low pressure.",
    "PENDING_APPROVAL",
    null,
    null,
    null,
  );
  await createDecidedActivity(
    planningEmployee,
    "Order prioritization update",
    "Added three urgent customer orders to the line schedule.",
    "CHANGES_REQUESTED",
    changesRequestedReason?.id ?? null,
    changesRequestedReason ? "CHANGES_REQUESTED" : null,
    "Please specify which orders were prioritized and which work orders were rescheduled.",
  );
  await createDecidedActivity(
    planningEmployee,
    "Order prioritization update (duplicate)",
    "Duplicate entry for work order schedule.",
    "REJECTED",
    rejectedReason?.id ?? null,
    rejectedReason ? "REJECTED" : null,
    "Identical entry has already been recorded for this date.",
  );
  log("records added for all four approval states");

  // --- Follow-Up Items -----------------------------------------------------
  const ceoViewer = { id: ceo.id, isSystemAdmin: false };
  const existingFollowUps = await db.followUpItem.count();

  if (existingFollowUps === 0) {
    const candidates = await activityMaintenanceReader(db).findMany({
      where: { approvalStatus: "APPROVED" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true },
    });

    if (candidates.length >= 3) {
      const fresh = await openFollowUp(
        db,
        ceoViewer,
        {
          activityId: candidates[0].id,
          nextStep: "Obtain written delivery confirmation from supplier.",
        },
        now,
      );
      if (fresh.ok) log("open follow-up item added");

      const toolingActivity = await activityMaintenanceReader(db).findFirst({
        where: { authorId: toolingEmployee.id, approvalStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      const stale = toolingActivity
        ? await openFollowUp(
            db,
            ceoViewer,
            {
              activityId: toolingActivity.id,
              nextStep: "Perform engineering evaluation for permanent solution.",
              ownerId: toolingManager.id,
            },
            now,
          )
        : ({ ok: false } as const);

      if (stale.ok) {
        const pastDate = new Date(now.getTime() - 20 * 24 * 3_600_000);
        await db.followUpItem.update({
          where: { id: stale.item.id },
          data: { openedAt: pastDate, lastMovedAt: pastDate, createdAt: pastDate },
        });
        log("stale follow-up item added");
      }

      const toClose = await openFollowUp(
        db,
        ceoViewer,
        {
          activityId: candidates[2].id,
          nextStep: "Place order for replacement spare parts.",
        },
        now,
      );

      if (toClose.ok) {
        await closeFollowUp(
          db,
          ceoViewer,
          toClose.item.id,
          "Replacement part received and installed; issue resolved.",
          now,
        );
        log("closed follow-up item added");
      }
    }
  }

  // --- Read Receipts -------------------------------------------------------
  const readActivities = await activityMaintenanceReader(db).findMany({
    where: { authorId: { not: ceo.id }, approvalStatus: "APPROVED" },
    orderBy: { createdAt: "desc" },
    skip: 4,
    take: 10,
    select: { id: true },
  });

  for (const activity of readActivities) {
    await db.readReceipt.upsert({
      where: { activityId_userId: { activityId: activity.id, userId: ceo.id } },
      update: {},
      create: {
        activityId: activity.id,
        userId: ceo.id,
        firstReadAt: now,
        lastReadAt: now,
      },
    });
  }
  log(`${readActivities.length} activities marked as read for CEO`);

  // --- Calendar: Holidays --------------------------------------------------
  const currentYear = Number(todayStr.slice(0, 4));
  const DEMO_HOLIDAYS = [
    { date: `${currentYear}-01-01`, name: "New Year's Day" },
    { date: `${currentYear}-04-20`, name: "Spring Holiday" },
    { date: `${currentYear}-05-01`, name: "Labor Day" },
    { date: `${currentYear}-07-04`, name: "Mid-Year Break" },
    { date: `${currentYear}-10-12`, name: "Autumn Holiday" },
    { date: `${currentYear}-12-25`, name: "Winter Holiday" },
  ];

  for (const holiday of DEMO_HOLIDAYS) {
    await db.holiday.upsert({
      where: { date: toDateValue(holiday.date) },
      update: {},
      create: { date: toDateValue(holiday.date), description: holiday.name },
    });
  }
  log(`${DEMO_HOLIDAYS.length} holidays added to calendar`);

  // --- Help Articles -------------------------------------------------------
  const DEMO_HELP_ARTICLES = [
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

  let addedHelpCount = 0;
  for (const [index, article] of DEMO_HELP_ARTICLES.entries()) {
    const existing = await db.helpArticle.findFirst({
      where: {
        category: article.category,
        title: article.title,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existing) continue;

    const result = await createHelpArticle(
      db,
      ceo.id,
      {
        ...article,
        sortOrder: index,
        isPublished: true,
      },
      now,
    );
    if (!result.ok) throw new Error(`${article.title}: ${result.message}`);
    addedHelpCount += 1;
  }
  if (addedHelpCount > 0) log(`${addedHelpCount} help articles added`);

  // --- Absence Records -----------------------------------------------------
  const existingAbsences = await db.noActivityPeriod.count();
  if (existingAbsences === 0) {
    const employeeOnLeave = employees.get(`hannah.assembly@${DEMO_EMAIL_DOMAIN}`);
    const assemblyManager = employees.get(`samantha.assembly@${DEMO_EMAIL_DOMAIN}`);

    if (employeeOnLeave && assemblyManager) {
      const startDate = new Date(now.getTime() - 2 * 24 * 3_600_000);
      const endDate = new Date(now.getTime() + 3 * 24 * 3_600_000);

      await db.noActivityPeriod.create({
        data: {
          userId: employeeOnLeave.id,
          startDate: toDateValue(companyDay(startDate)),
          endDate: toDateValue(companyDay(endDate)),
          note: "Annual leave",
          markedById: assemblyManager.id,
          status: "APPROVED",
          decidedAt: now,
          decidedById: assemblyManager.id,
        },
      });
      log("absence record added");
    }
  }

  const boardMember = employees.get(`board@${DEMO_EMAIL_DOMAIN}`);
  const toolingWorker = employees.get(`oliver.tooling@${DEMO_EMAIL_DOMAIN}`);

  if (boardMember) {
    const note = "Example: approved by executive";
    const existing = await db.noActivityPeriod.findFirst({
      where: { userId: boardMember.id, note },
      select: { id: true },
    });
    if (!existing) {
      const startDate = companyDay(new Date(now.getTime() + 6 * 86_400_000));
      const endDate = companyDay(new Date(now.getTime() + 8 * 86_400_000));
      const result = await markOwnNoActivityPeriod(
        db,
        boardMember.id,
        {
          startDate,
          endDate,
          note,
        },
        now,
      );
      if (!result.ok) throw new Error(`Board demo absence: ${result.message}`);
      log("approved absence example added for Board member");
    }
  }

  // Sample appreciation by Board member
  if (boardMember && toolingActivities.length > 0) {
    const appreciation = await db.activityAppreciation.findUnique({
      where: {
        activityId_userId: {
          activityId: toolingActivities[0].id,
          userId: boardMember.id,
        },
      },
      select: { activityId: true },
    });

    if (!appreciation) {
      await db.activityAppreciation.create({
        data: {
          activityId: toolingActivities[0].id,
          userId: boardMember.id,
          createdAt: now,
        },
      });
      log("sample appreciation added by Board member");
    }
  }

  if (toolingWorker && toolingManager) {
    const pendingNote = "Example: pending manager approval";
    const pending = await db.noActivityPeriod.findFirst({
      where: { userId: toolingWorker.id, note: pendingNote },
      select: { id: true },
    });
    if (!pending) {
      const startDate = companyDay(new Date(now.getTime() + 10 * 86_400_000));
      const endDate = companyDay(new Date(now.getTime() + 11 * 86_400_000));
      const result = await markOwnNoActivityPeriod(
        db,
        toolingWorker.id,
        { startDate, endDate, note: pendingNote },
        now,
      );
      if (!result.ok) throw new Error(`Pending absence example: ${result.message}`);
      log("pending absence request added");
    }

    const rejectedNote = "Example: rejected absence request";
    let rejected = await db.noActivityPeriod.findFirst({
      where: { userId: toolingWorker.id, note: rejectedNote },
      select: { id: true, status: true },
    });
    if (!rejected) {
      const startDate = companyDay(new Date(now.getTime() + 14 * 86_400_000));
      const endDate = companyDay(new Date(now.getTime() + 15 * 86_400_000));
      const result = await markOwnNoActivityPeriod(
        db,
        toolingWorker.id,
        { startDate, endDate, note: rejectedNote },
        now,
      );
      if (!result.ok) throw new Error(`Rejected absence example: ${result.message}`);
      rejected = { id: result.id, status: result.status };
    }
    if (rejected.status === "PENDING") {
      const result = await decideNoActivityPeriod(
        db,
        toolingManager.id,
        rejected.id,
        "REJECTED",
        "Review dates and resubmit with updated coverage plan.",
        now,
      );
      if (!result.ok) throw new Error(`Rejected absence example: ${result.message}`);
      log("rejected absence request added");
    }
  }

  // --- Deputy Example ------------------------------------------------------
  const hasDeputy = await db.noActivityPeriod.count({
    where: { deputyId: { not: null } },
  });

  if (hasDeputy === 0) {
    const cto = employees.get(`kevin.engineering@${DEMO_EMAIL_DOMAIN}`);
    const deputy = employees.get(`amanda.tooling@${DEMO_EMAIL_DOMAIN}`);
    const ceoUser = employees.get(`alex.morgan@${DEMO_EMAIL_DOMAIN}`);

    if (cto && deputy && ceoUser) {
      const startDate = new Date(now.getTime() - 1 * 24 * 3_600_000);
      const endDate = new Date(now.getTime() + 4 * 24 * 3_600_000);

      await db.noActivityPeriod.create({
        data: {
          userId: cto.id,
          startDate: toDateValue(companyDay(startDate)),
          endDate: toDateValue(companyDay(endDate)),
          note: "Annual leave — Tooling Manager acting as deputy",
          deputyId: deputy.id,
          markedById: ceoUser.id,
        },
      });
      log("deputy example added (Engineering → Tooling Manager)");
    }
  }

  // --- Inactive User -------------------------------------------------------
  const inactiveUser = employees.get(`george.inactive@${DEMO_EMAIL_DOMAIN}`);
  if (inactiveUser) {
    await db.user.update({
      where: { id: inactiveUser.id },
      data: { isActive: false },
    });
  }

  // --- Notifications -------------------------------------------------------
  const hasNotifications = await db.notificationQueue.count({
    where: { idempotencyKey: { startsWith: "demo-data:" } },
  });

  if (hasNotifications === 0) {
    const sampleActivities = await activityMaintenanceReader(db).findMany({
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, title: true, authorId: true },
    });

    const notifications: {
      userId: string;
      eventType: string;
      activity: { id: string; title: string };
      isSeen: boolean;
      minutesAgo: number;
    }[] = [];

    if (sampleActivities.length >= 3) {
      notifications.push(
        {
          userId: toolingManager.id,
          eventType: NOTIFICATION_EVENTS.approvalPending,
          activity: sampleActivities[0],
          isSeen: false,
          minutesAgo: 12,
        },
        {
          userId: toolingManager.id,
          eventType: NOTIFICATION_EVENTS.questionAsked,
          activity: sampleActivities[1],
          isSeen: false,
          minutesAgo: 95,
        },
        {
          userId: ceo.id,
          eventType: NOTIFICATION_EVENTS.answerReceived,
          activity: sampleActivities[1],
          isSeen: true,
          minutesAgo: 260,
        },
        {
          userId: planningEmployee.id,
          eventType: NOTIFICATION_EVENTS.changesRequested,
          activity: sampleActivities[2],
          isSeen: false,
          minutesAgo: 40,
        },
        {
          userId: toolingEmployee.id,
          eventType: NOTIFICATION_EVENTS.activityApproved,
          activity: sampleActivities[2],
          isSeen: true,
          minutesAgo: 1500,
        },
      );
    }

    for (const [order, notif] of notifications.entries()) {
      const createdAt = new Date(now.getTime() - notif.minutesAgo * 60_000);

      await db.notificationQueue.create({
        data: {
          userId: notif.userId,
          eventType: notif.eventType,
          channel: "EMAIL",
          payload: {
            activityId: notif.activity.id,
            activityTitle: notif.activity.title,
          },
          idempotencyKey: `demo-data:${notif.eventType}:${order}`,
          status: "SENT",
          sentAt: createdAt,
          seenAt: notif.isSeen ? createdAt : null,
          createdAt,
        },
      });
    }

    if (notifications.length > 0) log(`${notifications.length} notifications added`);
  }

  log("ready.");
  return { ok: true as const, log: logs };
}
