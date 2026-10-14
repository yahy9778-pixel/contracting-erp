const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export const fmtMoney = (n: number) => money.format(n);
export const fmtQty = (n: number) => qty.format(n);
export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  SUBMITTED: "مرفوع للاعتماد",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
  PAID: "مدفوع",
  ACTIVE: "قيد التنفيذ",
  ON_HOLD: "متوقف",
  COMPLETED: "منتهي",
};

export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

// تاريخ اليوم بصيغة YYYY-MM-DD محفوظ كمنتصف ليل UTC
export function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
