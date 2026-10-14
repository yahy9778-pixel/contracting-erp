import "server-only";
import { db } from "../db";
import { r2, ACC } from "../ledger";
import { daysBetween, fmtDate, parseDay, todayStr } from "../format";
import { projectSummary } from "../metrics";
import { projectAlerts } from "../alerts";
import { billableQuantities } from "../ipc-service";
import { costControl, projectPnl } from "../cost-control";
import { projectSchedule } from "../schedule-service";
import { accountBalance, partyBalances } from "../accounting";
import { serviceStatus } from "../operations";
import type { Role } from "../permissions";

// الأقسام الثمانية في نظام الوكلاء: لكل قسم مهامه، ومن يحق له تشغيله، والبيانات التي يقرؤها
export type Department = {
  key: string;
  name: string;
  roles: Role[];
  duties: string[];
  collect: (projectId: string) => Promise<Record<string, unknown>>;
};

const today = () => parseDay(todayStr());
const d = (x: Date | null | undefined) => fmtDate(x);

async function base(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { client: true, consultant: true } });
  return {
    today: todayStr(),
    project: {
      code: p.code,
      name: p.name,
      client: p.client.name,
      consultant: p.consultant?.name ?? null,
      contractValue: p.contractValue,
      start: d(p.startDate),
      end: d(p.endDate),
      retentionPct: p.retentionPct,
      advanceAmount: p.advanceAmount,
      vatPct: p.vatPct,
      requireInspection: p.requireInspection,
    },
  };
}

async function contractsData(projectId: string) {
  const [ipcs, subs, s] = await Promise.all([
    db.paymentCertificate.findMany({ where: { projectId }, orderBy: { number: "asc" } }),
    db.subcontract.findMany({ where: { projectId }, include: { subcontractor: true, lines: true, certificates: true } }),
    projectSummary(projectId),
  ]);
  const q = await billableQuantities(projectId);
  const items = await db.boqItem.findMany({ where: { projectId } });
  const notBilled = items
    .map((i) => ({ item: i.itemNo, desc: i.description, reported: q.reported.get(i.id) ?? 0, billable: q.billable.get(i.id) ?? 0 }))
    .filter((x) => x.reported > x.billable + 1e-9);
  return {
    executedValue: r2(s.executedValue),
    progressByValue: r2(s.progress),
    ipcs: ipcs.map((c) => ({ no: c.number, periodTo: d(c.periodTo), status: c.status, gross: c.currentGross, net: c.netPayable, approved: c.approvedAmount, retention: c.retention, advanceRecovery: c.advanceRecovery, paidAt: d(c.paidAt) })),
    executedButNotBillable: notBilled,
    subcontracts: subs.map((sc) => ({
      no: sc.number,
      subcontractor: sc.subcontractor.name,
      scope: sc.scope,
      value: r2(sc.lines.reduce((t, l) => t + l.quantity * l.rate, 0)),
      certificates: sc.certificates.map((c) => ({ no: c.number, status: c.status, net: c.netPayable })),
    })),
  };
}

async function planningData(projectId: string) {
  const sched = await projectSchedule(projectId, today());
  return {
    plannedPct: r2(sched.summary.planned * 100),
    actualPct: r2(sched.summary.actual * 100),
    spi: sched.summary.spi === null ? null : r2(sched.summary.spi),
    activities: sched.rows.map((r) => ({
      code: r.a.code,
      name: r.a.name,
      start: d(r.a.startDate),
      end: d(r.a.endDate),
      plannedPct: r2(r.planned * 100),
      actualPct: r2(r.actual * 100),
      status: r.status,
    })),
  };
}

async function costData(projectId: string) {
  const [cc, pnl] = await Promise.all([costControl(projectId), projectPnl(projectId)]);
  return {
    pnl: { revenue: pnl.revenue, cost: pnl.cost, margin: pnl.margin },
    costByCode: cc.rows.map((r) => ({ code: r.code?.code ?? null, name: r.code?.name ?? "بدون رمز", budget: r.budget, committed: r.committed, actual: r.actual, forecast: r.forecast, variance: r.variance })),
    totals: cc.totals,
  };
}

async function technicalData(projectId: string) {
  const t = today();
  const [subs, rfis] = await Promise.all([
    db.submittal.findMany({ where: { projectId }, orderBy: [{ number: "asc" }, { revision: "desc" }] }),
    db.rfi.findMany({ where: { projectId } }),
  ]);
  return {
    submittals: subs.map((s) => ({ no: s.number, rev: s.revision, type: s.type, title: s.title, status: s.status, due: d(s.dueDate), daysOverdue: s.status === "SUBMITTED" && s.dueDate ? Math.max(0, daysBetween(s.dueDate, t)) : 0 })),
    rfis: rfis.map((r) => ({ no: r.number, subject: r.subject, status: r.status, due: d(r.dueDate), daysOverdue: r.status === "OPEN" && r.dueDate ? Math.max(0, daysBetween(r.dueDate, t)) : 0 })),
  };
}

async function qualityData(projectId: string) {
  const [irs, ncrs] = await Promise.all([
    db.inspectionRequest.findMany({ where: { projectId }, include: { boqItem: true }, orderBy: { number: "desc" }, take: 20 }),
    db.ncr.findMany({ where: { projectId } }),
  ]);
  return {
    irs: irs.map((i) => ({ no: i.number, item: i.boqItem.itemNo, qty: i.quantity, status: i.status, date: d(i.inspectionDate), comment: i.comment })),
    ncrs: ncrs.map((n) => ({ no: n.number, source: n.source, status: n.status, description: n.description, due: d(n.dueDate) })),
  };
}

async function procurementData(projectId: string) {
  const [prs, pos, items, sums] = await Promise.all([
    db.purchaseRequest.findMany({ where: { projectId }, include: { submittal: true } }),
    db.purchaseOrder.findMany({ where: { projectId }, include: { supplier: true, lines: { include: { receipts: true } } } }),
    db.stockItem.findMany(),
    db.stockMove.groupBy({ by: ["itemId"], _sum: { quantity: true } }),
  ]);
  const stock = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  return {
    purchaseRequests: prs.map((p) => ({ no: p.number, title: p.title, status: p.status, required: d(p.requiredDate), submittalStatus: p.submittal?.status ?? null })),
    purchaseOrders: pos.map((p) => ({
      no: p.number,
      supplier: p.supplier.name,
      total: p.total,
      status: p.status,
      receivedPct: r2(
        (p.lines.reduce((t, l) => t + Math.min(l.quantity, l.receipts.reduce((s, r) => s + r.quantity, 0)) * l.unitPrice, 0) / Math.max(1, p.total)) * 100,
      ),
    })),
    supplierBalances: (await partyBalances(ACC.AP, projectId)).map((b) => ({ supplier: b.party.name, due: b.balance })),
    stockBelowMin: items.filter((i) => i.minQty > 0 && (stock.get(i.id) ?? 0) < i.minQty).map((i) => ({ item: i.name, unit: i.unit, balance: stock.get(i.id) ?? 0, min: i.minQty })),
  };
}

async function executionData(projectId: string) {
  const since = new Date(today().getTime() - 14 * 86_400_000);
  const [reports, equipment, usage, q] = await Promise.all([
    db.dailyReport.findMany({
      where: { projectId, date: { gte: since } },
      include: { manpower: true, equipment: true, progress: { include: { boqItem: true } } },
      orderBy: { date: "desc" },
    }),
    db.equipment.findMany({ where: { projectId } }),
    db.equipmentUsage.groupBy({ by: ["equipmentId"], where: { projectId, date: { gte: since } }, _sum: { hours: true } }),
    qualityData(projectId),
  ]);
  return {
    last14DaysReports: reports.map((r) => ({
      date: d(r.date),
      status: r.status,
      manpower: r.manpower.reduce((s, m) => s + m.count, 0),
      progress: r.progress.map((p) => `${p.boqItem.itemNo}: ${p.quantity} ${p.boqItem.unit}`),
      issues: r.issues,
    })),
    equipmentOnSite: equipment.map((e) => ({
      code: e.code,
      name: e.name,
      status: e.status,
      hoursLast14Days: usage.find((u) => u.equipmentId === e.id)?._sum.hours ?? 0,
      serviceDue: serviceStatus(e.meterHours, e.lastServiceAt, e.serviceInterval).due,
    })),
    quality: q,
  };
}

async function financeData(projectId: string) {
  const [cost, cash, bank, ar, ap, apSub, guarantees] = await Promise.all([
    costData(projectId),
    accountBalance(ACC.CASH, projectId),
    accountBalance(ACC.BANK, projectId),
    accountBalance(ACC.AR, projectId),
    accountBalance(ACC.AP, projectId),
    accountBalance(ACC.AP_SUB, projectId),
    db.bankGuarantee.findMany({ where: { projectId, status: "ACTIVE" } }),
  ]);
  return {
    ...cost,
    projectCash: r2(cash + bank),
    receivable: ar,
    payableSuppliers: ap,
    payableSubcontractors: apSub,
    guarantees: guarantees.map((g) => ({ type: g.type, bank: g.bank, amount: g.amount, expiry: d(g.expiryDate), daysLeft: daysBetween(today(), g.expiryDate) })),
  };
}

async function seniorData(projectId: string) {
  const t = today();
  const [alerts, plan, fin, employees] = await Promise.all([
    projectAlerts(projectId),
    planningData(projectId),
    financeData(projectId),
    db.employee.findMany({ where: { projectId, active: true } }),
  ]);
  return {
    alerts: alerts.map((a) => `${a.level === "high" ? "عاجل" : "متابعة"}: ${a.text}`),
    schedule: { plannedPct: plan.plannedPct, actualPct: plan.actualPct, spi: plan.spi, lateOrBehind: plan.activities.filter((a) => a.status === "LATE" || a.status === "BEHIND") },
    finance: { pnl: fin.pnl, projectCash: fin.projectCash, receivable: fin.receivable, payable: r2(fin.payableSuppliers + fin.payableSubcontractors), overBudget: fin.costByCode.filter((c) => c.budget > 0 && c.forecast > c.budget) },
    workforce: {
      count: employees.length,
      idsExpiringIn30Days: employees.filter((e) => e.idExpiry && daysBetween(t, e.idExpiry) <= 30).map((e) => ({ name: e.name, expiry: d(e.idExpiry) })),
    },
  };
}

export const DEPARTMENTS: Department[] = [
  {
    key: "senior",
    name: "الإدارة العليا",
    roles: ["OWNER"],
    duties: [
      "متابعة الأداء العام للمشروع: الوقت والتكلفة والجودة والسلامة والتدفق النقدي",
      "الإشراف على الجودة والسلامة والمعدات والورشة والمستودع المركزي والموارد البشرية والتطوير",
      "تحديد القرارات التي تحتاج تدخل الإدارة وترتيبها حسب الأثر",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await seniorData(id)) }),
  },
  {
    key: "contracts",
    name: "إدارة العقود",
    roles: ["OWNER", "CONTRACTS", "PROJECT_MANAGER"],
    duties: [
      "حماية حقوق الشركة في عقد المالك وعقود الباطن",
      "متابعة المستخلصات: الإعداد والرفع والاعتماد والتحصيل، والمحتجزات واسترداد الدفعة المقدمة",
      "رصد الأعمال المنفذة غير المفوترة وأسبابها",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await contractsData(id)) }),
  },
  {
    key: "pricing",
    name: "إدارة التسعير",
    roles: ["OWNER", "CONTRACTS"],
    duties: [
      "مقارنة أسعار العقد بالتكلفة الفعلية والمتوقعة لكل رمز تكلفة",
      "تحديد البنود الخاسرة أو ضعيفة الهامش لتصحيح التسعير في العطاءات القادمة",
      "مراجعة هوامش عقود الباطن",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await costData(id)), subcontracts: (await contractsData(id)).subcontracts }),
  },
  {
    key: "planning",
    name: "إدارة التخطيط",
    roles: ["OWNER", "PLANNING", "PROJECT_MANAGER"],
    duties: [
      "متابعة الجدول الزمني والمخطط مقابل الفعلي ومؤشر SPI",
      "تحديد الأنشطة المتأخرة وأسبابها المحتملة من التقارير والمشتريات والمكتب الفني",
      "ضبط التكاليف مقابل الموازنة",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await planningData(id)), cost: (await costData(id)).totals, technical: await technicalData(id) }),
  },
  {
    key: "technical",
    name: "المكتب الفني",
    roles: ["OWNER", "TECHNICAL", "PROJECT_MANAGER", "QUALITY"],
    duties: [
      "متابعة اعتماد المواد والمخططات التنفيذية وطرق التنفيذ (Submittals)",
      "متابعة الاستفسارات الفنية (RFI) وتأثير تأخرها على التنفيذ",
      "ربط التأخر الفني بالأنشطة والمشتريات المتأثرة",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await technicalData(id)), purchaseRequests: (await procurementData(id)).purchaseRequests }),
  },
  {
    key: "procurement",
    name: "المشتريات ومقاولو الباطن",
    roles: ["OWNER", "PROCUREMENT", "PROJECT_MANAGER", "STOREKEEPER"],
    duties: [
      "تأمين المواد في موعد احتياج الموقع بأفضل سعر",
      "متابعة طلبات الشراء وأوامر الشراء والاستلام وأرصدة الموردين",
      "متابعة المخزون تحت حد إعادة الطلب",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await procurementData(id)) }),
  },
  {
    key: "execution",
    name: "إدارة التنفيذ",
    roles: ["OWNER", "PROJECT_MANAGER", "QUALITY", "EQUIPMENT"],
    duties: [
      "متابعة الإنتاجية اليومية والعمالة والمعدات في الموقع",
      "متابعة الاستلامات وعدم المطابقة مع الجودة",
      "رصد المعوقات المتكررة في التقارير اليومية",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await executionData(id)) }),
  },
  {
    key: "finance",
    name: "الإدارة المالية",
    roles: ["OWNER", "FINANCE"],
    duties: [
      "متابعة ربحية المشروع والتكلفة الفعلية مقابل الموازنة",
      "متابعة السيولة والتحصيل والمستحقات للموردين ومقاولي الباطن",
      "متابعة خطابات الضمان قبل انتهائها",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await financeData(id)) }),
  },
];

export const departmentsFor = (role: string) => DEPARTMENTS.filter((d) => (d.roles as string[]).includes(role));
