import "server-only";
import { db } from "./db";
import { billableQuantities } from "./ipc-service";
import { parseDay, todayStr } from "./format";
import { GUARANTEE_WARNING_DAYS } from "./guarantees";
import { costControl } from "./cost-control";
import { projectSchedule } from "./schedule-service";

export type Alert = { level: "high" | "medium"; text: string; href: string; money?: boolean };

// تنبيهات المشروع: ما ينتظر قرارا أو تأخر عن موعده
// قواعد ثابتة اليوم، وسيشرحها ويرتبها وكيل الإدارة العليا في المرحلة الرابعة
// money: هل يرى المستخدم التنبيهات المالية (مهندس الموقع لا يراها)
export async function projectAlerts(projectId: string, opts: { money?: boolean } = {}): Promise<Alert[]> {
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
  const warnBy = new Date(today.getTime() + GUARANTEE_WARNING_DAYS * 86_400_000);
  const [expiredGs, expiringGs, subUnpaid, cc, sched] = await Promise.all([
    db.bankGuarantee.count({ where: { projectId, status: "ACTIVE", expiryDate: { lt: today } } }),
    db.bankGuarantee.count({ where: { projectId, status: "ACTIVE", expiryDate: { gte: today, lte: warnBy } } }),
    db.subcontractCertificate.count({ where: { status: "APPROVED", subcontract: { projectId } } }),
    costControl(projectId),
    projectSchedule(projectId, today),
  ]);
  const lateActs = sched.rows.filter((r) => r.status === "LATE").length;
  const behindActs = sched.rows.filter((r) => r.status === "BEHIND").length;
  const uninspected = q.requireInspection ? [...q.reported].filter(([id, qty]) => qty - (q.inspected.get(id) ?? 0) > 1e-9).length : 0;

  const alerts: Alert[] = [];
  const add = (cond: number, level: Alert["level"], text: string, href: string, money = false) => cond > 0 && alerts.push({ level, text, href, money });
  add(expiredGs, "high", `${expiredGs} خطاب ضمان انتهت صلاحيته وهو قائم`, `${p}/finance`, true);
  add(expiringGs, "high", `${expiringGs} خطاب ضمان ينتهي خلال ${GUARANTEE_WARNING_DAYS} يوما: اطلب التمديد`, `${p}/finance`, true);
  add(cc.overBudget.length, "high", `${cc.overBudget.length} رمز تكلفة تجاوزت تكلفته المتوقعة الموازنة`, `${p}/finance`, true);
  add(lateActs, "high", `${lateActs} نشاط تجاوز موعد نهايته ولم يكتمل`, `${p}/schedule`);
  add(behindActs, "medium", `${behindActs} نشاط خلف الخطة بأكثر من 10%`, `${p}/schedule`);
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
  add(subUnpaid, "medium", `${subUnpaid} مستخلص باطن معتمد ولم يُدفع`, `${p}/subcontracts`, true);
  add(ipcsApproved, "medium", `${ipcsApproved} مستخلص معتمد من الاستشاري ولم يُحصَّل بعد`, `${p}/ipcs`, true);
  return opts.money === false ? alerts.filter((a) => !a.money) : alerts;
}
