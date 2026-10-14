// حسابات الجدول الزمني والتدفق النقدي (دوال نقية مختبرة)

const DAY = 86_400_000;

// النسبة المخططة لنشاط في تاريخ معين: توزيع خطي بين البداية والنهاية
export function plannedPct(start: Date, end: Date, at: Date): number {
  const s = start.getTime();
  const e = end.getTime() + DAY; // يوم النهاية يُحسب كاملا
  const t = at.getTime() + DAY;
  if (t <= s) return 0;
  if (t >= e) return 1;
  return (t - s) / (e - s);
}

export type ActivityInput = { weight: number; start: Date; end: Date; actualPct: number };

export function scheduleSummary(acts: ActivityInput[], at: Date) {
  const total = acts.reduce((s, a) => s + a.weight, 0);
  if (total <= 0) return { planned: 0, actual: 0, spi: null as number | null };
  const planned = acts.reduce((s, a) => s + a.weight * plannedPct(a.start, a.end, at), 0) / total;
  const actual = acts.reduce((s, a) => s + a.weight * Math.min(1, Math.max(0, a.actualPct)), 0) / total;
  return { planned, actual, spi: planned > 0 ? actual / planned : null };
}

export type ActivityStatus = "DONE" | "LATE" | "BEHIND" | "ON_TRACK" | "NOT_STARTED";

// متأخر: انتهى موعده ولم يكتمل. خلف الخطة: الفارق أكثر من 10 نقاط مئوية
export function activityStatus(planned: number, actual: number, end: Date, at: Date): ActivityStatus {
  if (actual >= 0.999) return "DONE";
  if (at.getTime() > end.getTime()) return "LATE";
  if (planned - actual > 0.1) return "BEHIND";
  if (planned === 0 && actual === 0) return "NOT_STARTED";
  return "ON_TRACK";
}

// نهايات الأشهر بين تاريخين (UTC)، مع نقطة النهاية نفسها
export function monthEnds(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const last = new Date(Date.UTC(y, m + 1, 0));
    if (last.getTime() >= end.getTime()) break;
    out.push(last);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  out.push(end);
  return out;
}

export const monthStart = (d: Date, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
export const monthEnd = (d: Date, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0));

export type CashflowInput = {
  // القيمة المخططة للأعمال في كل شهر، تبدأ من (الشهر الحالي - مهلة التحصيل)
  plannedValue: number[];
  lagMonths: number;
  // نسبة ما يُحصل فعلا من قيمة الأعمال بعد المحتجز واسترداد الدفعة المقدمة
  collectionFactor: number;
  // نسبة التكلفة إلى قيمة العقد (من الموازنة)
  costRatio: number;
  openReceivable: number;
  openPayable: number;
  openingCash: number;
};

// توقع التدفق النقدي: التحصيل يتأخر بمهلة الاستشاري والمالك، والصرف في شهر التنفيذ
export function cashflowForecast(input: CashflowInput) {
  const months = input.plannedValue.length - input.lagMonths;
  const rows = [];
  let cumulative = input.openingCash;
  for (let i = 0; i < months; i++) {
    const inflow = input.plannedValue[i] * input.collectionFactor + (i === 0 ? input.openReceivable : 0);
    const outflow = input.plannedValue[i + input.lagMonths] * input.costRatio + (i === 0 ? input.openPayable : 0);
    cumulative += inflow - outflow;
    rows.push({ inflow, outflow, net: inflow - outflow, cumulative });
  }
  return rows;
}
