import type { Prisma } from "@prisma/client";
import { averageCost, stockBalance } from "./operations";
import { r2 } from "./ledger";

type Tx = Prisma.TransactionClient;

export async function nextMoveNumber(tx: Tx) {
  const max = await tx.stockMove.aggregate({ _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}

// الصنف يُعرَّف بالاسم والوحدة؛ يُنشأ تلقائيا عند أول استلام
export async function findOrCreateItem(tx: Tx, name: string, unit: string, costCodeId: string | null) {
  const existing = await tx.stockItem.findUnique({ where: { name_unit: { name, unit } } });
  if (existing) return existing;
  const count = await tx.stockItem.count();
  return tx.stockItem.create({ data: { code: `M-${String(count + 1).padStart(4, "0")}`, name, unit, costCodeId } });
}

export async function itemAverageCost(tx: Tx, itemId: string) {
  return averageCost(await tx.stockMove.findMany({ where: { itemId }, select: { quantity: true, value: true } }));
}

export async function warehouseBalance(tx: Tx, warehouseId: string, itemId: string) {
  return stockBalance(await tx.stockMove.findMany({ where: { warehouseId, itemId }, select: { quantity: true } }));
}

// إدخال أسطر استلام أمر الشراء للمستودع بسعر الأمر
export async function receiveIntoWarehouse(
  tx: Tx,
  input: { grnId: string; warehouseId: string; date: Date; projectId: string; costCodeId: string | null; userId: string; reference: string | null },
  lines: { description: string; unit: string; quantity: number; unitPrice: number }[],
) {
  let number = await nextMoveNumber(tx);
  for (const l of lines) {
    const item = await findOrCreateItem(tx, l.description, l.unit, input.costCodeId);
    await tx.stockMove.create({
      data: {
        number: number++,
        date: input.date,
        type: "IN",
        warehouseId: input.warehouseId,
        itemId: item.id,
        quantity: l.quantity,
        unitCost: l.unitPrice,
        value: r2(l.quantity * l.unitPrice),
        projectId: input.projectId,
        grnId: input.grnId,
        reference: input.reference,
        createdById: input.userId,
      },
    });
  }
}
