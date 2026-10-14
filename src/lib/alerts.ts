import "server-only";
import { can, type Permission } from "./permissions";
import { db } from "./db";
import { billableQuantities } from "./ipc-service";
import { parseDay, todayStr } from "./format";
import { GUARANTEE_WARNING_DAYS } from "./guarantees";
import { costControl } from "./cost-control";
import { projectSchedule } from "./schedule-service";
import { serviceStatus } from "./operations";

export type Alert = { level: "high" | "medium"; text: string; href: string; perm?: Permission };

// تنبيهات المشروع: ما ينتظر قرارا أو تأخر عن موعده
// قواعد ثابتة اليوم، وسيشرحها ويرتبها وكيل الإدارة العليا في المرحلة الرابعة
// role: يرى المستخدم فقط التنبيهات التي تقوده لصفحة يملك صلاحيتها
export async function projectAlerts(projectId: string, opts: { role?: string } = {}): Promise<Alert[]> {
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
    projectSchedule(projectId, today, { curve: false }),
  ]);
  const [equipment, idsExpiring, stockItems, stockSums] = await Promise.all([
    db.equipment.findMany({ where: { projectId } }),
    db.employee.count({ where: { projectId, active: true, idExpiry: { lte: warnBy } } }),
    db.stockItem.findMany({ where: { minQty: { gt: 0 } } }),
    db.stockMove.groupBy({ by: ["itemId"], _sum: { quantity: true } }),
  ]);
  const [openLti, overdueObs, openHighObs] = await Promise.all([
    db.safetyIncident.count({ where: { projectId, status: "OPEN", kind: "LOST_TIME" } }),
    db.safetyObservation.count({ where: { projectId, status: "OPEN", dueDate: { lt: today } } }),
    db.safetyObservation.count({ where: { projectId, status: "OPEN", severity: "HIGH", dueDate: { gte: today } } }),
  ]);
  const serviceDue = equipment.filter((e) => serviceStatus(e.meterHours, e.lastServiceAt, e.serviceInterval).due).length;
  const inWorkshop = equipment.filter((e) => e.status === "MAINTENANCE").length;
  const lowStock = stockItems.filter((i) => (stockSums.find((x) => x.itemId === i.id)?._sum.quantity ?? 0) < i.minQty).length;
  const lateActs = sched.rows.filter((r) => r.status === "LATE").length;
  const behindActs = sched.rows.filter((r) => r.status === "BEHIND").length;
  const uninspected = q.requireInspection ? [...q.reported].filter(([id, qty]) => qty - (q.inspected.get(id) ?? 0) > 1e-9).length : 0;

  const alerts: Alert[] = [];
  const add = (cond: number, level: Alert["level"], text: string, href: string, perm?: Permission) => cond > 0 && alerts.push({ level, text, href, perm });
  add(expiredGs, "high", `${expiredGs} خطاب ضمان انتهت صلاحيته وهو قائم`, `${p}/finance`, "money.view");
  add(expiringGs, "high", `${expiringGs} خطاب ضمان ينتهي خلال ${GUARANTEE_WARNING_DAYS} يوما: اطلب التمديد`, `${p}/finance`, "money.view");
  add(cc.overBudget.length, "high", `${cc.overBudget.length} رمز تكلفة تجاوزت تكلفته المتوقعة الموازنة`, `${p}/finance`, "money.view");
  add(lateActs, "high", `${lateActs} نشاط تجاوز موعد نهايته ولم يكتمل`, `${p}/schedule`);
  add(behindActs, "medium", `${behindActs} نشاط خلف الخطة بأكثر من 10%`, `${p}/schedule`);
  add(openLti, "high", `${openLti} إصابة مضيعة للوقت لم يُغلق تحقيقها`, `${p}/safety`);
  add(overdueObs, "high", `${overdueObs} ملاحظة سلامة تجاوزت موعد تصحيحها`, `${p}/safety`);
  add(openHighObs, "medium", `${openHighObs} ملاحظة سلامة عالية الخطورة مفتوحة`, `${p}/safety`);
  add(serviceDue, "high", `${serviceDue} معدة في الموقع تجاوزت موعد صيانتها الوقائية`, "/equipment", "equipment.view");
  add(idsExpiring, "high", `${idsExpiring} عامل أو موظف في الموقع تنتهي إقامته خلال 30 يوما`, "/hr", "hr.view");
  add(inWorkshop, "medium", `${inWorkshop} معدة من معدات الموقع في الورشة`, "/equipment", "equipment.view");
  add(lowStock, "medium", `${lowStock} صنف في المستودعات تحت حد إعادة الطلب`, "/stores", "store.view");
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
  add(subUnpaid, "medium", `${subUnpaid} مستخلص باطن معتمد ولم يُدفع`, `${p}/subcontracts`, "money.view");
  add(ipcsApproved, "medium", `${ipcsApproved} مستخلص معتمد من الاستشاري ولم يُحصَّل بعد`, `${p}/ipcs`, "money.view");
  return opts.role ? alerts.filter((a) => !a.perm || can(opts.role!, a.perm)) : alerts;
}
