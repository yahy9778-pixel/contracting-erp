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
import { safetyStats } from "../safety-service";
import { stockBelowMin } from "../stock-levels";
import type { Role } from "../permissions";

// أقسام نظام الوكلاء: لكل قسم مهامه، ومن يحق له تشغيله، والبيانات التي يقرؤها
export type Department = {
  key: string;
  name: string;
  roles: Role[];
  duties: string[];
  collect: (projectId: string) => Promise<Record<string, unknown>>;
};

const today = () => parseDay(todayStr());
// التاريخ الفارغ يصل للوكيل null لا "—"
const d = (x: Date | null | undefined) => (x ? fmtDate(x) : null);

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
    ipcs: ipcs.map((c) => ({ no: c.number, periodTo: d(c.periodTo), status: c.status, gross: c.currentGross, net: c.netPayable, approved: c.approvedAmount, approvedAt: d(c.approvedAt), retention: c.retention, advanceRecovery: c.advanceRecovery, paidAt: d(c.paidAt) })),
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
  const sched = await projectSchedule(projectId, today(), { curve: false });
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

// forecast: الفعلي + باقي الأعمال بسعر الموازنة. forecastAtCurrentRate: لو استمر الصرف بنفس الوتيرة
async function costData(projectId: string) {
  const [cc, pnl] = await Promise.all([costControl(projectId), projectPnl(projectId)]);
  return {
    pnl: { revenue: pnl.revenue, cost: pnl.cost, margin: pnl.margin },
    costByCode: cc.rows.map((r) => ({
      code: r.code?.code ?? null,
      name: r.code?.name ?? "بدون رمز",
      budget: r.budget,
      committed: r.committed,
      actual: r.actual,
      pctComplete: r.pctComplete,
      earned: r.earned,
      cpi: r.cpi,
      forecast: r.forecast,
      forecastAtCurrentRate: r.forecastAtCurrentRate,
      variance: r.variance,
      overBudget: r.overBudget,
      noBudget: r.noBudget,
    })),
    totals: cc.totals,
    overBudget: cc.overBudget.map((r) => r.code?.code),
  };
}

// هامش كل رمز للتسعير: قيمة العقد مقابل التكلفة المتوقعة
async function pricingData(projectId: string) {
  const cc = await costControl(projectId);
  return {
    marginByCode: cc.rows
      .filter((r) => r.contractValue > 0)
      .map((r) => ({
        code: r.code?.code ?? null,
        name: r.code?.name ?? "بدون رمز",
        contractValue: r.contractValue,
        budget: r.budget,
        pctComplete: r.pctComplete,
        earnedRevenue: r.executedValue,
        actual: r.actual,
        forecast: r.forecast,
        forecastAtCurrentRate: r.forecastAtCurrentRate,
        margin: r.margin,
        marginPct: r.marginPct,
      })),
  };
}

async function technicalData(projectId: string) {
  const t = today();
  const [subs, rfis] = await Promise.all([
    db.submittal.findMany({ where: { projectId }, orderBy: [{ number: "asc" }, { revision: "desc" }] }),
    db.rfi.findMany({ where: { projectId } }),
  ]);
  return {
    submittals: subs.map((s) => ({
      no: s.number,
      rev: s.revision,
      type: s.type,
      title: s.title,
      status: s.status,
      due: d(s.dueDate),
      daysOverdue: s.status === "SUBMITTED" && s.dueDate ? Math.max(0, daysBetween(s.dueDate, t)) : 0,
      // C أو D: مرفوض أو يعاد تقديمه، والمدة منذ رد الاستشاري تقيس تأخر إعادة التقديم
      daysSinceRejection: (s.status === "C" || s.status === "D") && s.respondedAt ? Math.max(0, daysBetween(s.respondedAt, t)) : null,
    })),
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
  const [prs, pos, stock] = await Promise.all([
    db.purchaseRequest.findMany({ where: { projectId }, include: { submittal: true } }),
    db.purchaseOrder.findMany({ where: { projectId }, include: { supplier: true, lines: { include: { receipts: true } } } }),
    stockBelowMin(projectId),
  ]);
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
    projectHasWarehouse: stock.hasWarehouse,
    stockBelowMin: stock.items,
  };
}

async function executionData(projectId: string) {
  const since = new Date(today().getTime() - 14 * 86_400_000);
  const [reports, q, safety, equipment] = await Promise.all([
    db.dailyReport.findMany({
      where: { projectId, date: { gte: since } },
      include: { manpower: true, equipment: true, progress: { include: { boqItem: true } } },
      orderBy: { date: "desc" },
    }),
    qualityData(projectId),
    safetyStats(projectId),
    equipmentData(projectId),
  ]);
  return {
    last14DaysReports: reports.map((r) => ({
      date: d(r.date),
      status: r.status,
      manpower: r.manpower.reduce((s, m) => s + m.count, 0),
      equipment: r.equipment.map((e) => `${e.name} × ${e.count}`),
      progress: r.progress.map((p) => `${p.boqItem.itemNo}: ${p.quantity} ${p.boqItem.unit}`),
      issues: r.issues,
    })),
    // ملخص من وكلاء الجودة والسلامة والآليات: التفاصيل لدى كل منهم
    qualitySummary: { rejectedIrs: q.irs.filter((i) => i.status === "REJECTED").length, openNcrs: q.ncrs.filter((n) => n.status !== "CLOSED").length },
    safetySummary: { openIncidents: safety.openIncidents, lti: safety.lti, openObs: safety.openObs, overdueObs: safety.overdueObs },
    equipmentSummary: equipment.onSite.map((e) => ({ code: e.code, name: e.name, status: e.status, serviceDue: e.serviceDue })),
  };
}

async function qualityFullData(projectId: string) {
  const t = today();
  const [q, irCounts, ncrs] = await Promise.all([
    qualityData(projectId),
    db.inspectionRequest.groupBy({ by: ["status"], where: { projectId }, _count: true }),
    db.ncr.findMany({ where: { projectId, status: { not: "CLOSED" } } }),
  ]);
  const total = irCounts.reduce((s, c) => s + c._count, 0);
  const rejected = irCounts.find((c) => c.status === "REJECTED")?._count ?? 0;
  return {
    ...q,
    irStats: { total, byStatus: Object.fromEntries(irCounts.map((c) => [c.status, c._count])), rejectionRatePct: total ? r2((rejected / total) * 100) : null },
    overdueNcrs: ncrs.filter((n) => n.dueDate && n.dueDate < t).map((n) => ({ no: n.number, description: n.description, due: d(n.dueDate), daysOverdue: daysBetween(n.dueDate!, t) })),
  };
}

async function equipmentData(projectId: string) {
  const t = today();
  const since = new Date(t.getTime() - 14 * 86_400_000);
  const [onSite, unassigned, usage] = await Promise.all([
    db.equipment.findMany({ where: { projectId }, include: { workOrders: { orderBy: { openedAt: "desc" }, take: 5 } } }),
    db.equipment.findMany({ where: { projectId: null } }),
    db.equipmentUsage.groupBy({ by: ["equipmentId"], where: { projectId, date: { gte: since } }, _sum: { hours: true } }),
  ]);
  return {
    onSite: onSite.map((e) => ({
      code: e.code,
      name: e.name,
      ownership: e.ownership,
      status: e.status,
      hourlyRate: e.hourlyRate,
      hoursLast14Days: usage.find((u) => u.equipmentId === e.id)?._sum.hours ?? 0,
      meterHours: e.meterHours,
      serviceDue: serviceStatus(e.meterHours, e.lastServiceAt, e.serviceInterval).due,
      // أوامر الورشة: سبب التوقف ومدته
      workOrders: e.workOrders.map((w) => ({
        no: w.number,
        kind: w.kind,
        description: w.description,
        status: w.status,
        openedAt: d(w.openedAt),
        daysOpen: w.status === "OPEN" ? daysBetween(w.openedAt, t) : null,
        cost: w.cost,
        resolution: w.resolution,
      })),
    })),
    // معدات غير معيّنة على أي مشروع: متاحة للنقل بدل الاستئجار
    unassignedEquipment: unassigned.map((e) => ({ code: e.code, name: e.name, status: e.status, ownership: e.ownership })),
  };
}

async function hrData(projectId: string) {
  const t = today();
  const since = new Date(t.getTime() - 14 * 86_400_000);
  const [employees, payroll, manpower] = await Promise.all([
    db.employee.findMany({ where: { projectId, active: true } }),
    db.payrollLine.findMany({ where: { projectId }, include: { run: true }, orderBy: { run: { month: "desc" } } }),
    db.dailyReport.findMany({ where: { projectId, date: { gte: since }, status: "APPROVED" }, include: { manpower: true }, orderBy: { date: "desc" } }),
  ]);
  const byTrade = new Map<string, number>();
  for (const e of employees) byTrade.set(e.trade ?? e.jobTitle, (byTrade.get(e.trade ?? e.jobTitle) ?? 0) + 1);
  const months = [...new Set(payroll.map((l) => l.run.month))].slice(0, 3);
  return {
    workforce: {
      staff: employees.filter((e) => e.kind === "STAFF").length,
      labor: employees.filter((e) => e.kind === "LABOR").length,
      byTrade: Object.fromEntries(byTrade),
    },
    idsExpiringIn60Days: employees
      .filter((e) => e.idExpiry && daysBetween(t, e.idExpiry) <= 60)
      .map((e) => ({ name: e.name, jobTitle: e.jobTitle, expiry: d(e.idExpiry), daysLeft: daysBetween(t, e.idExpiry!) })),
    // العمالة في التقارير اليومية مقابل العمالة المسجلة على المشروع
    reportedManpowerLast14Days: manpower.map((r) => ({ date: d(r.date), count: r.manpower.reduce((s, m) => s + m.count, 0) })),
    payrollLast3Months: months.map((m) => {
      const lines = payroll.filter((l) => l.run.month === m);
      return {
        month: m,
        status: lines[0].run.status,
        employees: lines.length,
        net: r2(lines.reduce((s, l) => s + l.net, 0)),
        overtimeHours: r2(lines.reduce((s, l) => s + l.overtimeHours, 0)),
        overtimePay: r2(lines.reduce((s, l) => s + l.overtimePay, 0)),
        deductions: r2(lines.reduce((s, l) => s + l.deductions, 0)),
      };
    }),
  };
}

async function safetyData(projectId: string) {
  const [stats, obs, incidents] = await Promise.all([
    safetyStats(projectId),
    db.safetyObservation.findMany({ where: { projectId, status: "OPEN" } }),
    db.safetyIncident.findMany({ where: { projectId }, orderBy: { date: "desc" }, take: 10 }),
  ]);
  return {
    ...stats,
    // LTIFR لكل مليون ساعة: غير معبّر قبل تراكم ساعات كافية
    ltifrReliable: stats.manHours >= 200_000,
    openObservations: obs.map((o) => ({ no: o.number, category: o.category, severity: o.severity, description: o.description, owner: o.assignedTo, due: d(o.dueDate) })),
    recentIncidents: incidents.map((i) => ({ no: i.number, date: d(i.date), kind: i.kind, description: i.description, status: i.status, lostDays: i.lostDays })),
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
  const ipcs = await db.paymentCertificate.findMany({ where: { projectId, status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, orderBy: { number: "asc" } });
  return {
    ...cost,
    // المستخلصات: أيام الانتظار منذ الاعتماد لما لم يُحصّل
    ipcs: ipcs.map((c) => ({
      no: c.number,
      status: c.status,
      net: c.netPayable,
      approved: c.approvedAmount,
      approvedAt: d(c.approvedAt),
      paidAt: d(c.paidAt),
      daysUnpaidSinceApproval: c.status === "APPROVED" && c.approvedAt ? daysBetween(c.approvedAt, today()) : null,
    })),
    projectCash: r2(cash + bank),
    receivable: ar,
    payableSuppliers: ap,
    payableSubcontractors: apSub,
    guarantees: guarantees.map((g) => ({ type: g.type, bank: g.bank, amount: g.amount, expiry: d(g.expiryDate), daysLeft: daysBetween(today(), g.expiryDate) })),
  };
}

async function seniorData(projectId: string) {
  const t = today();
  const [alerts, plan, fin, employees, central] = await Promise.all([
    projectAlerts(projectId),
    planningData(projectId),
    financeData(projectId),
    db.employee.findMany({ where: { projectId, active: true } }),
    stockBelowMin(null),
  ]);
  return {
    alerts: alerts.map((a) => `${a.level === "high" ? "عاجل" : "متابعة"}: ${a.text}`),
    schedule: { plannedPct: plan.plannedPct, actualPct: plan.actualPct, spi: plan.spi, lateOrBehind: plan.activities.filter((a) => a.status === "LATE" || a.status === "BEHIND") },
    finance: { pnl: fin.pnl, projectCash: fin.projectCash, receivable: fin.receivable, payable: r2(fin.payableSuppliers + fin.payableSubcontractors), overBudget: fin.costByCode.filter((c) => c.code !== null && c.overBudget) },
    safety: await safetyData(projectId),
    workforce: {
      count: employees.length,
      idsExpiringIn30Days: employees.filter((e) => e.idExpiry && daysBetween(t, e.idExpiry) <= 30).map((e) => ({ name: e.name, expiry: d(e.idExpiry) })),
    },
    centralWarehouseBelowMin: central.items,
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
    collect: async (id) => ({ ...(await base(id)), ...(await costData(id)), ...(await pricingData(id)), subcontracts: (await contractsData(id)).subcontracts }),
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
    roles: ["OWNER", "PROJECT_MANAGER"],
    duties: [
      "متابعة الإنتاجية اليومية والعمالة والمعدات في الموقع",
      "رصد المعوقات المتكررة في التقارير اليومية وربطها بالأقسام المعنية",
      "متابعة التقارير اليومية غير المعتمدة لأنها لا تدخل في الإنجاز",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await executionData(id)) }),
  },
  {
    key: "quality",
    name: "الجودة QA/QC",
    roles: ["OWNER", "QUALITY", "PROJECT_MANAGER"],
    duties: [
      "متابعة طلبات الاستلام (IR) ونسبة الرفض وأسبابها",
      "متابعة تقارير عدم المطابقة (NCR) حتى الإغلاق، والمتأخر منها",
      "تحديد الأعمال المنفذة المعطلة عن الفوترة بسبب الاستلام",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await qualityFullData(id)), executedButNotBillable: (await contractsData(id)).executedButNotBillable }),
  },
  {
    key: "safety",
    name: "السلامة والصحة المهنية",
    roles: ["OWNER", "SAFETY", "PROJECT_MANAGER"],
    duties: [
      "متابعة الحوادث والإصابات المضيعة للوقت وإغلاق تحقيقاتها",
      "متابعة ملاحظات التفتيش المفتوحة والمتأخرة عن موعد التصحيح",
      "متابعة معدلات السلامة والتوعية (Toolbox Talks). LTIFR غير معبّر إذا كان ltifrReliable = false",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await safetyData(id)) }),
  },
  {
    key: "equipment",
    name: "الآليات والصيانة",
    roles: ["OWNER", "EQUIPMENT", "PROJECT_MANAGER"],
    duties: [
      "متابعة جاهزية معدات الموقع والصيانة الوقائية المستحقة",
      "متابعة أوامر الورشة المفتوحة: سبب التوقف ومدته وتكلفته",
      "اقتراح نقل المعدات غير المعيّنة بدل الاستئجار، ورصد المعدات قليلة الاستخدام",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await equipmentData(id)) }),
  },
  {
    key: "hr",
    name: "الموارد البشرية",
    roles: ["OWNER", "HR"],
    duties: [
      "متابعة الإقامات والهويات قبل انتهائها",
      "مقارنة العمالة المسجلة على المشروع بالعمالة في التقارير اليومية",
      "متابعة مسير الرواتب والعمل الإضافي والخصومات",
    ],
    collect: async (id) => ({ ...(await base(id)), ...(await hrData(id)) }),
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
