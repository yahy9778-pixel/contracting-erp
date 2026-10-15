import "server-only";
import { db } from "./db";

// الأصناف تحت حد إعادة الطلب في مستودعات مشروع، أو في المستودع المركزي (projectId = null)
// يُحسب فقط للأصناف التي تحركت في هذه المستودعات، حتى لا يظهر صنف لا يُخزَّن فيها أصلا
export async function stockBelowMin(projectId: string | null) {
  const warehouses = await db.warehouse.findMany({ where: { projectId }, select: { id: true } });
  if (warehouses.length === 0) return { hasWarehouse: false, items: [] };
  const [items, sums] = await Promise.all([
    db.stockItem.findMany({ where: { minQty: { gt: 0 } } }),
    db.stockMove.groupBy({ by: ["itemId"], where: { warehouseId: { in: warehouses.map((w) => w.id) } }, _sum: { quantity: true } }),
  ]);
  const stock = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  return {
    hasWarehouse: true,
    items: items
      .filter((i) => stock.has(i.id) && stock.get(i.id)! < i.minQty)
      .map((i) => ({ item: i.name, unit: i.unit, balance: stock.get(i.id)!, min: i.minQty })),
  };
}
