"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";

const path = (projectId: string) => `/projects/${projectId}/quality`;

export async function createIr(projectId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "ir.create");
      const boqItemId = str(form, "boqItemId");
      const location = str(form, "location");
      const quantity = num(form, "quantity");
      const date = str(form, "inspectionDate");
      if (!boqItemId || !location || !date) throw new Error("البند والموقع وتاريخ الاستلام مطلوبة");
      if (quantity <= 0) throw new Error("الكمية المطلوب استلامها يجب أن تكون أكبر من صفر");
      const item = await db.boqItem.findFirst({ where: { id: boqItemId, projectId } });
      if (!item) throw new Error("البند غير موجود");
      const max = await db.inspectionRequest.aggregate({ where: { projectId }, _max: { number: true } });
      const ir = await db.inspectionRequest.create({
        data: {
          projectId,
          number: (max._max.number ?? 0) + 1,
          boqItemId,
          location,
          quantity,
          inspectionDate: parseDay(date),
          createdById: user.id,
        },
      });
      await audit(user.id, "create", "InspectionRequest", ir.id, { number: ir.number });
    },
    "تم تسجيل طلب الاستلام",
  );
}

const IR_DECISIONS = ["APPROVED", "APPROVED_WITH_COMMENTS", "REJECTED"];

export async function recordIr(projectId: string, irId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "ir.record");
      const decision = str(form, "decision");
      if (!IR_DECISIONS.includes(decision)) throw new Error("اختر نتيجة الاستلام");
      const comment = str(form, "comment");
      if (decision !== "APPROVED" && !comment) throw new Error("اكتب ملاحظات الاستشاري");
      const ir = await db.inspectionRequest.findFirst({ where: { id: irId, projectId } });
      if (!ir || ir.status !== "OPEN") throw new Error("طلب الاستلام ليس مفتوحا");
      await db.inspectionRequest.update({
        where: { id: irId },
        data: { status: decision, comment: comment || null, reviewedAt: new Date() },
      });
      // الرفض يفتح تقرير عدم مطابقة تلقائيا حتى تتم متابعة الإصلاح
      if (decision === "REJECTED") {
        const max = await db.ncr.aggregate({ where: { projectId }, _max: { number: true } });
        await db.ncr.create({
          data: {
            projectId,
            number: (max._max.number ?? 0) + 1,
            source: "CONSULTANT",
            boqItemId: ir.boqItemId,
            location: ir.location,
            description: `رفض طلب الاستلام رقم ${ir.number}: ${comment}`,
            createdById: user.id,
          },
        });
      }
      await audit(user.id, `ir-${decision.toLowerCase()}`, "InspectionRequest", irId);
    },
    "تم تسجيل نتيجة الاستلام",
  );
}

export async function createNcr(projectId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "ncr.manage");
      const description = str(form, "description");
      if (!description) throw new Error("وصف عدم المطابقة مطلوب");
      const source = str(form, "source") === "INTERNAL" ? "INTERNAL" : "CONSULTANT";
      const due = str(form, "dueDate");
      const max = await db.ncr.aggregate({ where: { projectId }, _max: { number: true } });
      const ncr = await db.ncr.create({
        data: {
          projectId,
          number: (max._max.number ?? 0) + 1,
          source,
          boqItemId: str(form, "boqItemId") || null,
          location: str(form, "location") || null,
          description,
          dueDate: due ? parseDay(due) : null,
          createdById: user.id,
        },
      });
      await audit(user.id, "create", "Ncr", ncr.id, { number: ncr.number });
    },
    "تم تسجيل تقرير عدم المطابقة",
  );
}

export async function closeNcr(projectId: string, ncrId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "ncr.manage");
      const correctiveAction = str(form, "correctiveAction");
      if (!correctiveAction) throw new Error("اكتب الإجراء التصحيحي قبل الإغلاق");
      const ncr = await db.ncr.findFirst({ where: { id: ncrId, projectId } });
      if (!ncr || ncr.status !== "OPEN") throw new Error("التقرير ليس مفتوحا");
      await db.ncr.update({ where: { id: ncrId }, data: { status: "CLOSED", correctiveAction, closedAt: new Date() } });
      await audit(user.id, "close", "Ncr", ncrId);
    },
    "تم إغلاق تقرير عدم المطابقة",
  );
}
