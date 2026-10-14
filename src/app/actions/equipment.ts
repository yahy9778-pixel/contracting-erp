"use server";

import { db } from "@/lib/db";
import { requirePermission, requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay, todayStr } from "@/lib/format";
import { cashAccountCode, postEquipmentUsage, postWorkOrder } from "@/lib/accounting";
import { r2 } from "@/lib/ledger";

const EQ = "/equipment";

export async function createEquipment(form: FormData) {
  await runAction(
    EQ,
    async () => {
      const user = await requirePermission("equipment.manage");
      const code = str(form, "code");
      const name = str(form, "name");
      const hourlyRate = num(form, "hourlyRate");
      if (!code || !name || hourlyRate <= 0) throw new Error("الرمز والاسم وتكلفة الساعة مطلوبة");
      if (await db.equipment.findUnique({ where: { code } })) throw new Error("رمز المعدة مستخدم");
      const ownership = str(form, "ownership") === "RENTED" ? "RENTED" : "OWNED";
      let supplierId: string | null = null;
      if (ownership === "RENTED") {
        const supplier = str(form, "supplier");
        if (!supplier) throw new Error("اكتب اسم مؤجر المعدة");
        supplierId =
          (await db.party.findFirst({ where: { name: supplier, type: "SUPPLIER" } }))?.id ??
          (await db.party.create({ data: { name: supplier, type: "SUPPLIER", category: "E3" } })).id;
      }
      const interval = num(form, "serviceInterval");
      const meter = num(form, "meterHours");
      const projectId = str(form, "projectId") || null;
      const e = await db.equipment.create({
        data: {
          code,
          name,
          costCode: ["E3", "F2", "F3"].includes(str(form, "costCode")) ? str(form, "costCode") : "E3",
          ownership,
          supplierId,
          hourlyRate,
          projectId,
          status: projectId ? "ACTIVE" : "IDLE",
          meterHours: meter,
          lastServiceAt: meter,
          serviceInterval: interval > 0 ? interval : null,
        },
      });
      await audit(user.id, "create", "Equipment", e.id);
    },
    "تمت إضافة المعدة",
  );
}

export async function assignEquipment(equipmentId: string, form: FormData) {
  await runAction(
    EQ,
    async () => {
      const user = await requirePermission("equipment.manage");
      const e = await db.equipment.findUnique({ where: { id: equipmentId } });
      if (!e) throw new Error("المعدة غير موجودة");
      if (e.status === "MAINTENANCE") throw new Error("المعدة في الورشة، أغلق أمر العمل أولا");
      const projectId = str(form, "projectId") || null;
      await db.equipment.update({ where: { id: e.id }, data: { projectId, status: projectId ? "ACTIVE" : "IDLE" } });
      await audit(user.id, "assign", "Equipment", e.id, { projectId });
    },
    "تم نقل المعدة",
  );
}

// تسجيل ساعات التشغيل: تُحمَّل على المشروع ويزيد عداد المعدة
export async function logUsage(form: FormData) {
  await runAction(
    EQ,
    async () => {
      const equipmentId = str(form, "equipmentId");
      const e = await db.equipment.findUnique({ where: { id: equipmentId } });
      if (!e) throw new Error("اختر المعدة");
      if (!e.projectId) throw new Error("المعدة غير مخصصة لمشروع");
      const { user } = await requireProjectAccess(e.projectId, "equipment.log");
      if (e.status === "MAINTENANCE") throw new Error("المعدة في الورشة ولا يمكن تسجيل تشغيل لها");
      const hours = num(form, "hours");
      if (hours <= 0 || hours > 24) throw new Error("ساعات التشغيل بين 0 و24 في اليوم");
      const usage = await db.$transaction(async (tx) => {
        const u = await tx.equipmentUsage.create({
          data: {
            equipmentId,
            projectId: e.projectId!,
            date: parseDay(str(form, "date") || todayStr()),
            hours,
            rate: e.hourlyRate,
            operator: str(form, "operator") || null,
            notes: str(form, "notes") || null,
            createdById: user.id,
          },
        });
        await tx.equipment.update({ where: { id: e.id }, data: { meterHours: r2(e.meterHours + hours) } });
        await postEquipmentUsage(tx, u.id, user.id);
        return u;
      });
      await audit(user.id, "create", "EquipmentUsage", usage.id, { hours });
    },
    "تم تسجيل ساعات التشغيل وتحميلها على المشروع",
  );
}

export async function openWorkOrder(form: FormData) {
  await runAction(
    EQ,
    async () => {
      const user = await requirePermission("equipment.manage");
      const equipmentId = str(form, "equipmentId");
      const description = str(form, "description");
      const kind = str(form, "kind") === "BREAKDOWN" ? "BREAKDOWN" : "PREVENTIVE";
      if (!equipmentId || !description) throw new Error("حدد المعدة ووصف العمل");
      if (await db.workOrder.findFirst({ where: { equipmentId, status: "OPEN" } })) throw new Error("للمعدة أمر عمل مفتوح");
      const max = await db.workOrder.aggregate({ _max: { number: true } });
      const wo = await db.$transaction(async (tx) => {
        const created = await tx.workOrder.create({ data: { number: (max._max.number ?? 0) + 1, equipmentId, kind, description, createdById: user.id } });
        await tx.equipment.update({ where: { id: equipmentId }, data: { status: "MAINTENANCE" } });
        return created;
      });
      await audit(user.id, "create", "WorkOrder", wo.id);
    },
    "تم فتح أمر العمل ونقل المعدة للورشة",
  );
}

export async function closeWorkOrder(workOrderId: string, form: FormData) {
  await runAction(
    EQ,
    async () => {
      const user = await requirePermission("equipment.manage");
      const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, include: { equipment: true } });
      if (!wo || wo.status !== "OPEN") throw new Error("أمر العمل مغلق");
      const resolution = str(form, "resolution");
      if (!resolution) throw new Error("اكتب ما تم إصلاحه");
      const cost = r2(num(form, "cost"));
      if (cost < 0) throw new Error("التكلفة لا تكون سالبة");
      await db.$transaction(async (tx) => {
        const paidFrom = cost > 0 ? await cashAccountCode(tx, str(form, "cashAccount")) : null;
        await tx.workOrder.update({ where: { id: wo.id }, data: { status: "DONE", resolution, cost, paidFrom, closedAt: new Date() } });
        await tx.equipment.update({
          where: { id: wo.equipmentId },
          data: { status: wo.equipment.projectId ? "ACTIVE" : "IDLE", ...(wo.kind === "PREVENTIVE" ? { lastServiceAt: wo.equipment.meterHours } : {}) },
        });
        await postWorkOrder(tx, wo.id, user.id);
      });
      await audit(user.id, "close", "WorkOrder", wo.id, { cost });
    },
    "تم إغلاق أمر العمل وعادت المعدة للخدمة",
  );
}
