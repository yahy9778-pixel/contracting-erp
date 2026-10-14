// مؤشرات السلامة (دوال نقية مختبرة)

export const HOURS_PER_WORKER_DAY = 8;
export const INCIDENT_KINDS: Record<string, string> = {
  NEAR_MISS: "حادث وشيك (Near miss)",
  FIRST_AID: "إسعاف أولي",
  LOST_TIME: "إصابة مضيعة للوقت (LTI)",
  PROPERTY_DAMAGE: "تلف ممتلكات",
  ENVIRONMENT: "حادث بيئي",
};
export const OBS_CATEGORIES: Record<string, string> = {
  PPE: "معدات الوقاية الشخصية",
  HOUSEKEEPING: "النظافة والترتيب",
  SCAFFOLDING: "السقالات والعمل على ارتفاع",
  EXCAVATION: "الحفريات",
  ELECTRICAL: "الكهرباء",
  LIFTING: "الرفع والرافعات",
  FIRE: "الحريق",
  OTHER: "أخرى",
};
export const SEVERITY_LABELS: Record<string, string> = { HIGH: "عالية", MEDIUM: "متوسطة", LOW: "منخفضة" };
// مهلة التصحيح الافتراضية حسب الخطورة
export const SEVERITY_DAYS: Record<string, number> = { HIGH: 1, MEDIUM: 3, LOW: 7 };

// معدل الإصابات المضيعة للوقت لكل مليون ساعة عمل
export function ltifr(lostTimeIncidents: number, manHours: number): number | null {
  return manHours > 0 ? (lostTimeIncidents * 1_000_000) / manHours : null;
}

export function daysSince(dates: Date[], today: Date, since: Date): number {
  const last = dates.reduce<Date | null>((m, d) => (!m || d > m ? d : m), null) ?? since;
  return Math.max(0, Math.floor((today.getTime() - last.getTime()) / 86_400_000));
}
