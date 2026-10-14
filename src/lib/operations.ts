// قواعد المخازن والرواتب والمعدات (دوال نقية مختبرة)
import { ACC, r2, type Line } from "./ledger";

// ───────── المخازن ─────────

// متوسط التكلفة المرجح من كل الحركات السابقة للصنف
export function averageCost(moves: { quantity: number; value: number }[]): number {
  const qty = moves.reduce((s, m) => s + m.quantity, 0);
  const value = moves.reduce((s, m) => s + m.value, 0);
  return qty > 1e-9 ? value / qty : 0;
}

export function stockBalance(moves: { quantity: number }[]): number {
  return Math.round(moves.reduce((s, m) => s + m.quantity, 0) * 1000) / 1000;
}

// ───────── الرواتب ─────────

export const PAYROLL_DAYS = 30;
// أجر ساعة العمل الإضافي = أجر الساعة الأساسي × 1.5 (الأجر الشهري ÷ 30 يوم ÷ 8 ساعات)
export const OVERTIME_FACTOR = 1.5;

export function payrollLine(input: { basicSalary: number; allowances: number; daysWorked: number; overtimeHours: number; deductions: number }) {
  if (input.daysWorked < 0 || input.daysWorked > PAYROLL_DAYS) throw new Error(`أيام العمل بين 0 و${PAYROLL_DAYS}`);
  if (input.overtimeHours < 0 || input.deductions < 0) throw new Error("الإضافي والخصومات لا تكون سالبة");
  const ratio = input.daysWorked / PAYROLL_DAYS;
  const basic = r2(input.basicSalary * ratio);
  const allowances = r2(input.allowances * ratio);
  const overtimePay = r2(input.overtimeHours * (input.basicSalary / PAYROLL_DAYS / 8) * OVERTIME_FACTOR);
  const gross = basic + allowances + overtimePay;
  if (input.deductions > gross + 0.005) throw new Error("الخصومات أكبر من مستحقات الموظف");
  return { basic, allowances, overtimePay, deductions: r2(input.deductions), net: r2(gross - input.deductions) };
}

// اعتماد مسير الرواتب: رواتب الموقع تكلفة عمالة على المشروع، ورواتب المركز الرئيسي مصاريف إدارية
export function payrollApprovalLines(lines: { projectId: string | null; net: number }[], laborCostCodeId: string | null): Line[] {
  const byProject = new Map<string | null, number>();
  for (const l of lines) byProject.set(l.projectId, (byProject.get(l.projectId) ?? 0) + l.net);
  const total = lines.reduce((s, l) => s + l.net, 0);
  return [
    ...[...byProject].map(([projectId, amount]) =>
      projectId
        ? { account: ACC.LABOR, debit: amount, projectId, costCodeId: laborCostCodeId }
        : { account: ACC.ADMIN, debit: amount, projectId: null, memo: "رواتب المركز الرئيسي" },
    ),
    { account: ACC.SALARIES_PAYABLE, credit: total, projectId: null },
  ];
}

// ───────── المعدات ─────────

export function serviceStatus(meterHours: number, lastServiceAt: number, interval: number | null) {
  if (!interval || interval <= 0) return { due: false, remaining: null as number | null };
  const remaining = r2(lastServiceAt + interval - meterHours);
  return { due: remaining <= 0, remaining };
}
