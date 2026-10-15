// التكلفة المتوقعة عند الانتهاء لرمز تكلفة، بنسبة الإنجاز
// الإنجاز = قيمة الكميات المنفذة المعتمدة لبنود الرمز ÷ قيمة بنوده في BOQ (null إذا لم يرتبط به بند)

export type CostCodeInput = {
  budget: number;
  committed: number;
  actual: number;
  // قيمة بنود الرمز في العقد، والقيمة المنفذة منها بأسعار العقد
  contractValue: number;
  executedValue: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function pctComplete(contractValue: number, executedValue: number): number | null {
  if (contractValue <= 0) return null;
  return Math.min(1, Math.max(0, executedValue / contractValue));
}

export function forecastCostCode(i: CostCodeInput) {
  const pct = pctComplete(i.contractValue, i.executedValue);
  // القيمة المكتسبة: الجزء من الموازنة المقابل للإنجاز
  const earned = pct === null ? null : r2(i.budget * pct);
  let forecast: number;
  if (pct === null || pct === 0) {
    // بلا بنود مرتبطة أو قبل بدء التنفيذ: لا استقراء، والرمز لا يقل عن موازنته
    forecast = Math.max(i.committed, i.actual, i.budget);
  } else {
    // الفعلي حتى الآن + باقي الأعمال بسعر الموازنة
    forecast = Math.max(i.committed, i.actual + i.budget * (1 - pct));
  }
  // استقراء بمعدل الصرف الحالي: لو استمر الصرف بنفس الوتيرة حتى الانتهاء
  const atCurrentRate = pct && i.actual > 0 ? r2(i.actual / pct) : null;
  const cpi = earned && i.actual > 0 ? r2(earned / i.actual) : null;
  forecast = r2(forecast);
  return {
    pctComplete: pct === null ? null : r2(pct * 100),
    earned,
    cpi,
    forecast,
    forecastAtCurrentRate: atCurrentRate,
    variance: r2(i.budget - forecast),
    // تكلفة على رمز بلا موازنة تُعد تجاوزا
    noBudget: i.budget <= 0 && (i.actual > 0 || i.committed > 0),
    overBudget: forecast > i.budget + 0.005,
    // الهامش المتوقع للرمز: قيمة العقد ناقص التكلفة المتوقعة
    margin: i.contractValue > 0 ? r2(i.contractValue - forecast) : null,
    marginPct: i.contractValue > 0 ? r2(((i.contractValue - forecast) / i.contractValue) * 100) : null,
  };
}
