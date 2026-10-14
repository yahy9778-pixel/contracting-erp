import "server-only";
import { db } from "./db";
import { HOURS_PER_WORKER_DAY, daysSince, ltifr } from "./safety";
import { parseDay, todayStr } from "./format";

// مؤشرات السلامة للمشروع: ساعات العمل من التقارير اليومية المعتمدة
export async function safetyStats(projectId: string) {
  const today = parseDay(todayStr());
  const [project, manpower, incidents, openObs, overdueObs, talks] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    db.manpowerEntry.aggregate({ where: { report: { projectId, status: "APPROVED" } }, _sum: { count: true } }),
    db.safetyIncident.findMany({ where: { projectId } }),
    db.safetyObservation.count({ where: { projectId, status: "OPEN" } }),
    db.safetyObservation.count({ where: { projectId, status: "OPEN", dueDate: { lt: today } } }),
    db.toolboxTalk.aggregate({ where: { projectId }, _count: true, _sum: { attendees: true } }),
  ]);
  const manHours = (manpower._sum.count ?? 0) * HOURS_PER_WORKER_DAY;
  const lti = incidents.filter((i) => i.kind === "LOST_TIME");
  return {
    manHours,
    lti: lti.length,
    lostDays: lti.reduce((s, i) => s + i.lostDays, 0),
    nearMisses: incidents.filter((i) => i.kind === "NEAR_MISS").length,
    incidents: incidents.length,
    openIncidents: incidents.filter((i) => i.status === "OPEN").length,
    ltifr: ltifr(lti.length, manHours),
    daysWithoutLti: daysSince(lti.map((i) => i.date), today, project.startDate ?? project.createdAt),
    openObs,
    overdueObs,
    talks: talks._count,
    talkAttendees: talks._sum.attendees ?? 0,
  };
}
