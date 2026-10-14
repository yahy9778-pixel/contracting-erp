// قواعد المحاسبة: دليل الحسابات وبناء القيود الآلية (دوال نقية مختبرة)

export const ACC = {
  CASH: "1100",
  BANK: "1110",
  AR: "1200",
  RET_REC: "1210",
  VAT_IN: "1300",
  INVENTORY: "1400",
  AP: "2100",
  AP_SUB: "2110",
  RET_PAY: "2120",
  ADV_CLIENT: "2200",
  VAT_OUT: "2300",
  SALARIES_PAYABLE: "2500",
  CAPITAL: "3100",
  RETAINED: "3200",
  REVENUE: "4100",
  MATERIALS: "5100",
  SUBCONTRACT: "5200",
  LABOR: "5300",
  EQUIPMENT: "5400",
  SITE_OH: "5500",
  TEMP_WORKS: "5600",
  EQUIP_RECOVERY: "5490",
  ADMIN: "6100",
  WORKSHOP: "6200",
  STOCK_DIFF: "6300",
} as const;

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export const CHART: { code: string; name: string; type: AccountType; isCash?: boolean }[] = [
  { code: ACC.CASH, name: "الصندوق والعهد النقدية", type: "ASSET", isCash: true },
  { code: ACC.BANK, name: "البنك", type: "ASSET", isCash: true },
  { code: ACC.AR, name: "العملاء (ذمم المستخلصات)", type: "ASSET" },
  { code: ACC.RET_REC, name: "محتجزات لدى العملاء", type: "ASSET" },
  { code: ACC.VAT_IN, name: "ضريبة القيمة المضافة على المشتريات", type: "ASSET" },
  { code: ACC.INVENTORY, name: "المخزون", type: "ASSET" },
  { code: ACC.AP, name: "الموردون", type: "LIABILITY" },
  { code: ACC.AP_SUB, name: "مقاولو الباطن", type: "LIABILITY" },
  { code: ACC.RET_PAY, name: "محتجزات مقاولي الباطن", type: "LIABILITY" },
  { code: ACC.ADV_CLIENT, name: "دفعات مقدمة من العملاء", type: "LIABILITY" },
  { code: ACC.VAT_OUT, name: "ضريبة القيمة المضافة على المبيعات", type: "LIABILITY" },
  { code: ACC.SALARIES_PAYABLE, name: "رواتب مستحقة", type: "LIABILITY" },
  { code: ACC.CAPITAL, name: "رأس المال", type: "EQUITY" },
  { code: ACC.RETAINED, name: "الأرباح المبقاة", type: "EQUITY" },
  { code: ACC.REVENUE, name: "إيرادات العقود", type: "REVENUE" },
  { code: ACC.MATERIALS, name: "تكاليف المواد", type: "EXPENSE" },
  { code: ACC.SUBCONTRACT, name: "تكاليف مقاولي الباطن", type: "EXPENSE" },
  { code: ACC.LABOR, name: "تكاليف العمالة المباشرة", type: "EXPENSE" },
  { code: ACC.EQUIPMENT, name: "تكاليف المعدات", type: "EXPENSE" },
  { code: ACC.SITE_OH, name: "مصاريف الموقع العامة", type: "EXPENSE" },
  { code: ACC.TEMP_WORKS, name: "تكاليف الأعمال المؤقتة", type: "EXPENSE" },
  { code: ACC.EQUIP_RECOVERY, name: "تكلفة المعدات المملوكة المحمّلة على المشاريع (دائن)", type: "EXPENSE" },
  { code: ACC.ADMIN, name: "مصاريف إدارية وعمومية", type: "EXPENSE" },
  { code: ACC.WORKSHOP, name: "مصاريف الورشة وصيانة المعدات", type: "EXPENSE" },
  { code: ACC.STOCK_DIFF, name: "فروقات الجرد", type: "EXPENSE" },
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "أصول",
  LIABILITY: "خصوم",
  EQUITY: "حقوق ملكية",
  REVENUE: "إيرادات",
  EXPENSE: "تكاليف ومصروفات",
};

export const r2 = (n: number) => {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return v === 0 ? 0 : v;
};

export type Line = {
  account: string;
  debit?: number;
  credit?: number;
  costCodeId?: string | null;
  partyId?: string | null;
  projectId?: string | null;
  memo?: string;
};

export type NormalLine = Omit<Line, "debit" | "credit"> & { debit: number; credit: number };

// تقريب الأسطر، حذف الأصفار، وتحويل المدين السالب إلى دائن. يرفض القيد غير المتوازن
export function normalizeLines(lines: Line[]): NormalLine[] {
  const out: NormalLine[] = [];
  for (const l of lines) {
    const net = r2((l.debit ?? 0) - (l.credit ?? 0));
    if (net === 0) continue;
    out.push({ ...l, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  if (out.length < 2) throw new Error("القيد يحتاج طرفين على الأقل");
  const d = r2(out.reduce((s, l) => s + l.debit, 0));
  const c = r2(out.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(d - c) > 0.005) throw new Error(`القيد غير متوازن: مدين ${d} ودائن ${c}`);
  return out;
}

// أي حساب تكلفة يُحمَّل عليه رمز التكلفة
export function costAccountFor(costCode: string | null | undefined): string {
  if (!costCode) return ACC.SITE_OH;
  if (costCode.startsWith("D")) return ACC.SUBCONTRACT;
  if (costCode === "E3" || costCode.startsWith("F2") || costCode.startsWith("F3")) return ACC.EQUIPMENT;
  if (costCode.startsWith("F")) return ACC.TEMP_WORKS;
  if (costCode.startsWith("E")) return ACC.MATERIALS;
  if (costCode.startsWith("L")) return ACC.LABOR;
  return ACC.SITE_OH;
}

// اعتماد مستخلص المالك: إثبات الإيراد والذمة والمحتجز واسترداد الدفعة المقدمة والضريبة.
// إذا اعتمد الاستشاري مبلغا مختلفا عن الصافي المحسوب يُسوّى الفرق في الإيراد
export function ipcApprovalLines(ipc: {
  currentGross: number;
  retention: number;
  advanceRecovery: number;
  vat: number;
  netPayable: number;
  approvedAmount: number | null;
  clientId: string;
}): Line[] {
  const approved = ipc.approvedAmount ?? ipc.netPayable;
  return [
    { account: ACC.AR, debit: approved, partyId: ipc.clientId },
    { account: ACC.RET_REC, debit: ipc.retention, partyId: ipc.clientId },
    { account: ACC.ADV_CLIENT, debit: ipc.advanceRecovery, partyId: ipc.clientId },
    { account: ACC.REVENUE, credit: ipc.currentGross + (approved - ipc.netPayable) },
    { account: ACC.VAT_OUT, credit: ipc.vat },
  ];
}

// اعتماد مستخلص الباطن: التكلفة حسب رمز تكلفة كل بند، والمستحق للمقاول، والمحتجز عليه، وضريبة المدخلات
export function subCertApprovalLines(cert: {
  lines: { amount: number; costCodeId: string | null }[];
  retention: number;
  vat: number;
  netPayable: number;
  partyId: string;
}): Line[] {
  const byCode = new Map<string | null, number>();
  for (const l of cert.lines) byCode.set(l.costCodeId, (byCode.get(l.costCodeId) ?? 0) + l.amount);
  return [
    ...[...byCode].map(([costCodeId, amount]) => ({ account: ACC.SUBCONTRACT, debit: amount, costCodeId })),
    { account: ACC.VAT_IN, debit: cert.vat },
    { account: ACC.AP_SUB, credit: cert.netPayable, partyId: cert.partyId },
    { account: ACC.RET_PAY, credit: cert.retention, partyId: cert.partyId },
  ];
}

// الرصيد بطبيعة الحساب: الأصول والتكاليف مدينة، والبقية دائنة
export function normalBalance(type: string, debit: number, credit: number) {
  return r2(type === "ASSET" || type === "EXPENSE" ? debit - credit : credit - debit);
}

// عدد أسطر نموذج القيد اليدوي
export const JOURNAL_LINES = 6;
