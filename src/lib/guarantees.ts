import { daysBetween } from "./format";

// أيام التنبيه قبل انتهاء خطاب الضمان (لطلب التمديد من البنك في وقته)
export const GUARANTEE_WARNING_DAYS = 30;

export function guaranteeState(g: { status: string; expiryDate: Date }, today: Date) {
  if (g.status !== "ACTIVE") return g.status;
  const left = daysBetween(today, g.expiryDate);
  if (left < 0) return "EXPIRED";
  if (left <= GUARANTEE_WARNING_DAYS) return "EXPIRING";
  return "ACTIVE";
}

// أيام التنبيه قبل انتهاء إقامة أو هوية موظف
export const DOC_WARNING_DAYS = 30;
