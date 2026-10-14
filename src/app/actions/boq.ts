"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseBoqText } from "@/lib/boq-import";

export async function addBoqItem(projectId: string, form: FormData) {
  const path = `/projects/${projectId}/boq`;
  await runAction(
    path,
    async () => {
      const { user } = await requireProjectAccess(projectId, "boq.edit");
      const itemNo = str(form, "itemNo");
      const description = str(form, "description");
      const unit = str(form, "unit");
      if (!itemNo || !description || !unit) throw new Error("رقم البند والوصف والوحدة مطلوبة");
      if (await db.boqItem.findUnique({ where: { projectId_itemNo: { projectId, itemNo } } })) {
        throw new Error(`البند ${itemNo} موجود مسبقا`);
      }
      const count = await db.boqItem.count({ where: { projectId } });
      const item = await db.boqItem.create({
        data: {
          projectId,
          itemNo,
          description,
          unit,
          quantity: num(form, "quantity"),
          rate: num(form, "rate"),
          costCodeId: str(form, "costCodeId") || null,
          sortOrder: count,
        },
      });
      await audit(user.id, "create", "BoqItem", item.id, { itemNo });
    },
    "تمت إضافة البند",
  );
}

export async function importBoq(projectId: string, form: FormData) {
  const path = `/projects/${projectId}/boq`;
  await runAction(path, async () => {
    const { user } = await requireProjectAccess(projectId, "boq.edit");
    const { rows, errors } = parseBoqText(str(form, "text"));
    if (errors.length) throw new Error(errors.slice(0, 5).join(" · "));
    if (!rows.length) throw new Error("لم يتم العثور على أي بند في النص");

    const codes = new Map((await db.costCode.findMany()).map((c) => [c.code.toUpperCase(), c.id]));
    const existing = new Set((await db.boqItem.findMany({ where: { projectId }, select: { itemNo: true } })).map((i) => i.itemNo));
    const dupes = rows.filter((r) => existing.has(r.itemNo)).map((r) => r.itemNo);
    if (dupes.length) throw new Error(`بنود موجودة مسبقا: ${dupes.slice(0, 10).join("، ")}`);

    const start = await db.boqItem.count({ where: { projectId } });
    await db.boqItem.createMany({
      data: rows.map((r, i) => ({
        projectId,
        itemNo: r.itemNo,
        description: r.description,
        unit: r.unit,
        quantity: r.quantity,
        rate: r.rate,
        costCodeId: r.costCode ? (codes.get(r.costCode.toUpperCase()) ?? null) : null,
        sortOrder: start + i,
      })),
    });
    await audit(user.id, "import", "BoqItem", projectId, { count: rows.length });
    return `${path}?notice=${encodeURIComponent(`تم استيراد ${rows.length} بند`)}`;
  });
}

export async function deleteBoqItem(projectId: string, itemId: string) {
  const path = `/projects/${projectId}/boq`;
  await runAction(
    path,
    async () => {
      const { user } = await requireProjectAccess(projectId, "boq.edit");
      const item = await db.boqItem.findFirst({
        where: { id: itemId, projectId },
        include: { _count: { select: { progress: true, ipcLines: true } } },
      });
      if (!item) throw new Error("البند غير موجود");
      if (item._count.progress || item._count.ipcLines) throw new Error("لا يمكن حذف بند عليه كميات منفذة أو مستخلصات");
      await db.boqItem.delete({ where: { id: itemId } });
      await audit(user.id, "delete", "BoqItem", itemId, { itemNo: item.itemNo });
    },
    "تم حذف البند",
  );
}
