import "server-only";
import { db } from "./db";
import { calculateIpc } from "./ipc";

// الكميات التراكمية المعتمدة لكل بند حتى تاريخ معين (من التقارير اليومية المعتمدة فقط)
export async function executedQuantities(projectId: string, upTo?: Date) {
  const rows = await db.progressEntry.groupBy({
    by: ["boqItemId"],
    where: {
      report: { projectId, status: "APPROVED", ...(upTo ? { date: { lte: upTo } } : {}) },
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.boqItemId, r._sum.quantity ?? 0]));
}

export async function previewIpc(projectId: string, periodTo: Date) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const [items, executed, previous, recovered] = await Promise.all([
    db.boqItem.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
    executedQuantities(projectId, periodTo),
    db.paymentCertificate.findFirst({
      where: { projectId },
      orderBy: { number: "desc" },
      include: { lines: true },
    }),
    db.paymentCertificate.aggregate({ where: { projectId }, _sum: { advanceRecovery: true } }),
  ]);

  const prevQty = new Map(previous?.lines.map((l) => [l.boqItemId, l.cumulativeQty]) ?? []);

  const result = calculateIpc(
    items.map((i) => ({
      boqItemId: i.id,
      rate: i.rate,
      contractQty: i.quantity,
      executedToDate: executed.get(i.id) ?? 0,
      previousQty: prevQty.get(i.id) ?? 0,
    })),
    {
      contractValue: project.contractValue,
      retentionPct: project.retentionPct,
      advanceAmount: project.advanceAmount,
      vatPct: project.vatPct,
      advanceRecoveredBefore: recovered._sum.advanceRecovery ?? 0,
      previousGross: previous?.grossCumulative ?? 0,
    },
  );

  return { result, previous, items, number: (previous?.number ?? 0) + 1 };
}

export async function createIpc(projectId: string, periodTo: Date) {
  const { result, previous, number } = await previewIpc(projectId, periodTo);
  if (previous && periodTo <= previous.periodTo) {
    throw new Error("تاريخ نهاية الفترة يجب أن يكون بعد المستخلص السابق");
  }
  if (result.currentGross <= 0) {
    throw new Error("لا توجد كميات معتمدة جديدة منذ المستخلص السابق");
  }
  return db.paymentCertificate.create({
    data: {
      projectId,
      number,
      periodTo,
      grossCumulative: result.grossCumulative,
      previousGross: result.previousGross,
      currentGross: result.currentGross,
      retention: result.retention,
      advanceRecovery: result.advanceRecovery,
      vat: result.vat,
      netPayable: result.netPayable,
      lines: {
        create: result.lines.map((l) => ({
          boqItemId: l.boqItemId,
          previousQty: l.previousQty,
          currentQty: l.currentQty,
          cumulativeQty: l.cumulativeQty,
          rate: l.rate,
        })),
      },
    },
  });
}
