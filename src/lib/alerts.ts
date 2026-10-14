import "server-only";
import { db } from "./db";
import { billableQuantities } from "./ipc-service";
import { parseDay, todayStr } from "./format";

export type Alert = { level: "high" | "medium"; text: string; href: string };

// تنبيهات المشروع: ما ينتظر قرارا أو تأخر عن موعده
// قواعد ثابتة اليوم، وسيشرحها ويرتبها وكيل الإدارة العليا في المرحلة الرابعة
export async function projectAlerts(projectId: string): Promise<Alert[]> {
  const today = parseDay(todayStr());
  const p = `/projects/${projectId}`;
  const [reports, openIrs, ncrs, overdueNcrs, lateSubs, lateRfis, prsPending, prsLate, posPending, ipcsApproved, q] = await Promise.all([
    db.dailyReport.count({ where: { projectId, status: "SUBMITTED" } }),
    db.inspectionRequest.count({ where: { projectId, status: "OPEN" } }),
    db.ncr.count({ where: { projectId, status: "OPEN" } }),
    db.ncr.count({ where: { projectId, status: "OPEN", dueDate: { lt: today } } }),
    db.submittal.count({ where: { projectId, status: "SUBMITTED", dueDate: { lt: today } } }),
    db.rfi.count({ where: { projectId, status: "OPEN", dueDate: { lt: today } } }),
    db.purchaseRequest.count({ where: { projectId, status: "SUBMITTED" } }),
    db.purchaseRequest.count({ where: { projectId, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] }, requiredDate: { lt: today } } }),
    db.purchaseOrder.count({ where: { projectId, status: "PENDING_APPROVAL" } }),
    db.paymentCertificate.count({ where: { projectId, status: "APPROVED" } }),
    billableQuantities(projectId),
  ]);
  const uninspected = q.requireInspection ? [...q.reported].filter(([id, qty]) => qty - (q.inspected.get(id) ?? 0) > 1e-9).length : 0;

  const alerts: Alert[] = [];
  const add = (cond: number, level: Alert["level"], text: string, href: string) => cond > 0 && alerts.push({ level, text, href });
  add(overdueNcrs, "high", `${overdueNcrs} تقرير عدم مطابقة تجاوز موعد إغلاقه`, `${p}/quality`);
  add(lateSubs, "high", `${lateSubs} Submittal تأخر رد الاستشاري عليه`, `${p}/technical`);
  add(lateRfis, "high", `${lateRfis} استفسار فني تأخر الرد عليه`, `${p}/technical`);
  add(prsLate, "high", `${prsLate} طلب شراء تجاوز تاريخ احتياج الموقع دون أمر شراء`, `${p}/procurement`);
  add(uninspected, "medium", `${uninspected} بند منفذ لم يستلمه الاستشاري بعد ولن يدخل المستخلص`, `${p}/quality`);
  add(reports, "medium", `${reports} تقرير يومي بانتظار اعتماد مدير المشروع`, `${p}/reports`);
  add(openIrs, "medium", `${openIrs} طلب استلام بانتظار نتيجة الاستشاري`, `${p}/quality`);
  add(ncrs - overdueNcrs, "medium", `${ncrs - overdueNcrs} تقرير عدم مطابقة مفتوح`, `${p}/quality`);
  add(prsPending, "medium", `${prsPending} طلب شراء بانتظار الاعتماد`, `${p}/procurement`);
  add(posPending, "medium", `${posPending} أمر شراء فوق حد الصلاحية بانتظار اعتماد المالك`, `${p}/procurement`);
  add(ipcsApproved, "medium", `${ipcsApproved} مستخلص معتمد من الاستشاري ولم يُحصَّل بعد`, `${p}/ipcs`);
  return alerts;
}
