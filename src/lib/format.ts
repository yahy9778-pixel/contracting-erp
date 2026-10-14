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
  OPEN: "مفتوح",
  CLOSED: "مغلق",
  APPROVED_WITH_COMMENTS: "معتمد بملاحظات",
  ANSWERED: "تم الرد",
  A: "A معتمد",
  B: "B معتمد بملاحظات",
  C: "C يعدل ويعاد",
  D: "D مرفوض",
  ORDERED: "تم الطلب",
  PENDING_APPROVAL: "بانتظار اعتماد الإدارة",
  ISSUED: "صادر للمورد",
  PARTIAL: "استلام جزئي",
  RECEIVED: "مستلم بالكامل",
  CANCELLED: "ملغي",
  RELEASED: "مُفرج عنه",
  DONE: "مكتمل",
  LATE: "متأخر عن موعده",
  BEHIND: "خلف الخطة",
  ON_TRACK: "حسب الخطة",
  NOT_STARTED: "لم يبدأ",
  EXPIRING: "ينتهي قريبا",
  EXPIRED: "منتهي الصلاحية",
};

export const GUARANTEE_TYPES: Record<string, string> = {
  BID: "ضمان ابتدائي",
  PERFORMANCE: "ضمان حسن التنفيذ",
  ADVANCE: "ضمان الدفعة المقدمة",
  RETENTION: "ضمان بدل المحتجز",
};

// فرق الأيام بين تاريخين
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

export const todayStr = () => new Date().toISOString().slice(0, 10);

// تاريخ مستحق انقضى ولم يُغلق
export const isOverdue = (due: Date | null | undefined) => Boolean(due && due.getTime() < parseDay(todayStr()).getTime());

export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

// تاريخ اليوم بصيغة YYYY-MM-DD محفوظ كمنتصف ليل UTC
export function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
