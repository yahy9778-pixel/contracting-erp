import "server-only";
import { db } from "./db";
import { executedQuantities } from "./ipc-service";

// ملخص المشروع: قيمة المنفذ المعتمد ونسبة الإنجاز المالية والتقارير المعلقة وآخر مستخلص
export async function projectSummary(projectId: string) {
  const [items, executed, pendingReports, lastIpc, ipcTotals] = await Promise.all([
    db.boqItem.findMany({ where: { projectId } }),
    executedQuantities(projectId),
    db.dailyReport.count({ where: { projectId, status: "SUBMITTED" } }),
    db.paymentCertificate.findFirst({ where: { projectId }, orderBy: { number: "desc" } }),
    db.paymentCertificate.aggregate({ where: { projectId, status: "PAID" }, _sum: { netPayable: true } }),
  ]);
  const boqValue = items.reduce((s, i) => s + i.quantity * i.rate, 0);
  const executedValue = items.reduce((s, i) => s + (executed.get(i.id) ?? 0) * i.rate, 0);
  return {
    boqValue,
    executedValue,
    progress: boqValue > 0 ? executedValue / boqValue : 0,
    pendingReports,
    lastIpc,
    collected: ipcTotals._sum.netPayable ?? 0,
  };
}
