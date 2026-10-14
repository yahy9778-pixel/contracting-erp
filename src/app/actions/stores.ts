"use server";

import { db } from "@/lib/db";
import { requirePermission, requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay, todayStr } from "@/lib/format";
import { postStockMove } from "@/lib/accounting";
import { itemAverageCost, nextMoveNumber, warehouseBalance } from "@/lib/stores";
import { r2 } from "@/lib/ledger";

const STORES = "/stores";

export async function createWarehouse(form: FormData) {
  await runAction(
    STORES,
    async () => {
      const user = await requirePermission("store.manage");
      const code = str(form, "code");
      const name = str(form, "name");
      if (!code || !name) throw new Error("رمز المستودع واسمه مطلوبان");
      if (await db.warehouse.findUnique({ where: { code } })) throw new Error("رمز المستودع مستخدم");
      const w = await db.warehouse.create({ data: { code, name, projectId: str(form, "projectId") || null } });
      await audit(user.id, "create", "Warehouse", w.id);
    },
    "تم إنشاء المستودع",
  );
}

// صرف مواد من المستودع لمشروع: يُحمَّل على رمز التكلفة بمتوسط التكلفة
export async function issueStock(form: FormData) {
  await runAction(
    STORES,
    async () => {
      const projectId = str(form, "projectId");
      if (!projectId) throw new Error("اختر المشروع");
      const { user } = await requireProjectAccess(projectId, "store.manage");
      const warehouseId = str(form, "warehouseId");
      const itemId = str(form, "itemId");
      const quantity = num(form, "quantity");
      if (!warehouseId || !itemId || quantity <= 0) throw new Error("حدد المستودع والصنف وكمية أكبر من صفر");
      const item = await db.stockItem.findUnique({ where: { id: itemId } });
      if (!item) throw new Error("الصنف غير موجود");
      const costCodeId = str(form, "costCodeId") || item.costCodeId;
      if (!costCodeId) throw new Error("حدد رمز التكلفة الذي تُحمَّل عليه المواد");
      const move = await db.$transaction(async (tx) => {
        const balance = await warehouseBalance(tx, warehouseId, itemId);
        if (quantity > balance + 1e-9) throw new Error(`الرصيد المتاح في المستودع ${balance} ${item.unit} فقط`);
        const avg = await itemAverageCost(tx, itemId);
        const m = await tx.stockMove.create({
          data: {
            number: await nextMoveNumber(tx),
            date: parseDay(str(form, "date") || todayStr()),
            type: "ISSUE",
            warehouseId,
            itemId,
            quantity: -quantity,
            unitCost: avg,
            value: -r2(quantity * avg),
            projectId,
            costCodeId,
            reference: str(form, "reference") || null,
            notes: str(form, "notes") || null,
            createdById: user.id,
          },
        });
        await postStockMove(tx, m.id, user.id);
        return m;
      });
      await audit(user.id, "issue", "StockMove", move.id, { quantity });
    },
    "تم صرف المواد وتحميلها على المشروع",
  );
}

export async function transferStock(form: FormData) {
  await runAction(
    STORES,
    async () => {
      const user = await requirePermission("store.manage");
      const from = str(form, "fromId");
      const to = str(form, "toId");
      const itemId = str(form, "itemId");
      const quantity = num(form, "quantity");
      if (!from || !to || from === to) throw new Error("اختر مستودعين مختلفين");
      if (!itemId || quantity <= 0) throw new Error("حدد الصنف وكمية أكبر من صفر");
      await db.$transaction(async (tx) => {
        const balance = await warehouseBalance(tx, from, itemId);
        if (quantity > balance + 1e-9) throw new Error(`الرصيد المتاح في مستودع الصرف ${balance} فقط`);
        const avg = await itemAverageCost(tx, itemId);
        const number = await nextMoveNumber(tx);
        const date = parseDay(str(form, "date") || todayStr());
        const common = { date, type: "TRANSFER", itemId, unitCost: avg, createdById: user.id, reference: str(form, "reference") || null };
        await tx.stockMove.create({ data: { ...common, number, warehouseId: from, quantity: -quantity, value: -r2(quantity * avg) } });
        await tx.stockMove.create({ data: { ...common, number: number + 1, warehouseId: to, quantity, value: r2(quantity * avg) } });
      });
      await audit(user.id, "transfer", "StockItem", itemId, { from, to, quantity });
    },
    "تم التحويل بين المستودعين",
  );
}

// الجرد الفعلي: يُدخل العدد الموجود فعلا، ويُسوّى الفرق بقيد فروقات جرد
export async function countStock(form: FormData) {
  await runAction(
    STORES,
    async () => {
      const user = await requirePermission("store.manage");
      const warehouseId = str(form, "warehouseId");
      const itemId = str(form, "itemId");
      const counted = num(form, "counted", -1);
      if (!warehouseId || !itemId || counted < 0) throw new Error("حدد المستودع والصنف والكمية الموجودة فعلا");
      const result = await db.$transaction(async (tx) => {
        const balance = await warehouseBalance(tx, warehouseId, itemId);
        const diff = Math.round((counted - balance) * 1000) / 1000;
        if (diff === 0) return 0;
        let unitCost = await itemAverageCost(tx, itemId);
        if (unitCost <= 0) unitCost = num(form, "unitCost");
        if (diff > 0 && unitCost <= 0) throw new Error("الصنف بلا تكلفة سابقة: أدخل تكلفة الوحدة لرصيده الافتتاحي");
        const m = await tx.stockMove.create({
          data: {
            number: await nextMoveNumber(tx),
            date: parseDay(todayStr()),
            type: "ADJUST",
            warehouseId,
            itemId,
            quantity: diff,
            unitCost,
            value: r2(diff * unitCost),
            notes: str(form, "notes") || (balance === 0 ? "رصيد افتتاحي" : `جرد: الدفتري ${balance} والفعلي ${counted}`),
            createdById: user.id,
          },
        });
        await postStockMove(tx, m.id, user.id);
        return diff;
      });
      await audit(user.id, "count", "StockItem", itemId, { counted, diff: result });
      return `${STORES}?notice=${encodeURIComponent(result === 0 ? "الرصيد مطابق، لا تسوية" : `تمت التسوية بفرق ${result}`)}`;
    },
  );
}

export async function createItem(form: FormData) {
  await runAction(
    STORES,
    async () => {
      const user = await requirePermission("store.manage");
      const name = str(form, "name");
      const unit = str(form, "unit");
      if (!name || !unit) throw new Error("اسم الصنف ووحدته مطلوبان");
      if (await db.stockItem.findUnique({ where: { name_unit: { name, unit } } })) throw new Error("الصنف موجود بنفس الوحدة");
      const count = await db.stockItem.count();
      const item = await db.stockItem.create({
        data: { code: `M-${String(count + 1).padStart(4, "0")}`, name, unit, costCodeId: str(form, "costCodeId") || null, minQty: num(form, "minQty") },
      });
      await audit(user.id, "create", "StockItem", item.id);
    },
    "تمت إضافة الصنف",
  );
}

export async function updateItemMin(itemId: string, form: FormData) {
  await runAction(
    STORES,
    async () => {
      const user = await requirePermission("store.manage");
      const minQty = num(form, "minQty");
      if (minQty < 0) throw new Error("حد إعادة الطلب لا يكون سالبا");
      await db.stockItem.update({ where: { id: itemId }, data: { minQty } });
      await audit(user.id, "update", "StockItem", itemId, { minQty });
    },
    "تم تحديث حد إعادة الطلب",
  );
}
