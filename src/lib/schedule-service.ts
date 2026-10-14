import "server-only";
import { db } from "./db";
import { executedQuantities } from "./ipc-service";
import { activityStatus, monthEnds, plannedPct, scheduleSummary } from "./schedule";
import { parseDay, todayStr } from "./format";

// الجدول الزمني للمشروع: المخطط والفعلي لكل نشاط وللمشروع، ومنحنى S
export async function projectSchedule(projectId: string, at = parseDay(todayStr())) {
  const [project, activities, executed] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    db.activity.findMany({ where: { projectId }, include: { boqItem: true }, orderBy: [{ sortOrder: "asc" }, { startDate: "asc" }] }),
    executedQuantities(projectId, at),
  ]);
  const actualOf = (a: (typeof activities)[number], exec: Map<string, number>) =>
    a.boqItem ? (a.boqItem.quantity > 0 ? Math.min(1, (exec.get(a.boqItem.id) ?? 0) / a.boqItem.quantity) : 0) : (a.manualPct ?? 0);

  const rows = activities.map((a) => {
    const planned = plannedPct(a.startDate, a.endDate, at);
    const actual = actualOf(a, executed);
    return { a, planned, actual, status: activityStatus(planned, actual, a.endDate, at) };
  });
  const totalWeight = activities.reduce((s, a) => s + a.weight, 0);
  const summary = scheduleSummary(
    activities.map((a) => ({ weight: a.weight, start: a.startDate, end: a.endDate, actualPct: actualOf(a, executed) })),
    at,
  );

  // منحنى S: المخطط شهريا حتى النهاية، والفعلي حتى اليوم (الأنشطة اليدوية تدخل بنسبتها الحالية في نقطة اليوم فقط)
  let curve: { date: Date; planned: number; actual: number | null }[] = [];
  if (activities.length) {
    const start = project.startDate ?? activities.reduce((m, a) => (a.startDate < m ? a.startDate : m), activities[0].startDate);
    const end = activities.reduce((m, a) => (a.endDate > m ? a.endDate : m), project.endDate ?? activities[0].endDate);
    const points = monthEnds(start, end);
    curve = await Promise.all(
      points.map(async (date) => {
        const planned = scheduleSummary(activities.map((a) => ({ weight: a.weight, start: a.startDate, end: a.endDate, actualPct: 0 })), date).planned;
        if (date.getTime() > at.getTime()) return { date, planned, actual: null };
        const exec = await executedQuantities(projectId, date);
        const actual = totalWeight > 0 ? activities.reduce((s, a) => s + a.weight * (a.boqItem ? actualOf(a, exec) : 0), 0) / totalWeight : 0;
        return { date, planned, actual };
      }),
    );
    if (at.getTime() > start.getTime() && at.getTime() < end.getTime() && !points.some((d) => d.getTime() === at.getTime())) {
      curve.push({ date: at, planned: summary.planned, actual: summary.actual });
      curve.sort((x, y) => x.date.getTime() - y.date.getTime());
    }
  }
  return { project, rows, summary, curve };
}

// القيمة المخططة للأعمال (بقيمة العقد) في كل شهر من شهر البداية لعدد من الأشهر
export async function plannedValueByMonth(projectId: string, from: Date, months: number) {
  const [project, activities] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    db.activity.findMany({ where: { projectId } }),
  ]);
  const acts = activities.map((a) => ({ weight: a.weight, start: a.startDate, end: a.endDate, actualPct: 0 }));
  const out: number[] = [];
  for (let i = 0; i < months; i++) {
    const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i + 1, 0));
    const prev = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 0));
    out.push(project.contractValue * (scheduleSummary(acts, end).planned - scheduleSummary(acts, prev).planned));
  }
  return out;
}
