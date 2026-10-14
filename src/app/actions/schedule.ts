"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";

const base = (projectId: string) => `/projects/${projectId}/schedule`;

function dates(form: FormData) {
  const start = str(form, "startDate");
  const end = str(form, "endDate");
  if (!start || !end) throw new Error("حدد تاريخ البداية والنهاية");
  if (end < start) throw new Error("تاريخ النهاية قبل تاريخ البداية");
  return { startDate: parseDay(start), endDate: parseDay(end) };
}

// نشاط لكل بند في جدول الكميات، بوزن قيمته، على كامل مدة المشروع. يعدّل المخطط التواريخ بعدها
export async function generateFromBoq(projectId: string) {
  await runAction(
    base(projectId),
    async () => {
      const { user, project } = await requireProjectAccess(projectId, "schedule.edit");
      if (!project.startDate || !project.endDate) throw new Error("حدد تاريخ بداية ونهاية المشروع أولا");
      if (await db.activity.count({ where: { projectId } })) throw new Error("الجدول موجود مسبقا");
      const items = await db.boqItem.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] });
      if (!items.length) throw new Error("جدول الكميات فارغ");
      await db.activity.createMany({
        data: items.map((i, idx) => ({
          projectId,
          code: i.itemNo,
          name: i.description,
          startDate: project.startDate!,
          endDate: project.endDate!,
          weight: i.quantity * i.rate,
          boqItemId: i.id,
          sortOrder: idx,
        })),
      });
      await audit(user.id, "generate", "Activity", projectId, { count: items.length });
    },
    "تم إنشاء الأنشطة من جدول الكميات، عدّل تواريخ كل نشاط حسب خطة التنفيذ",
  );
}

export async function createActivity(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "schedule.edit");
      const code = str(form, "code");
      const name = str(form, "name");
      if (!code || !name) throw new Error("رمز النشاط واسمه مطلوبان");
      const boqItemId = str(form, "boqItemId") || null;
      const item = boqItemId ? await db.boqItem.findFirst({ where: { id: boqItemId, projectId } }) : null;
      const weight = num(form, "weight", item ? item.quantity * item.rate : 0);
      if (weight <= 0) throw new Error("الوزن مطلوب للأنشطة غير المرتبطة ببند (مثلا قيمتها التقديرية)");
      if (await db.activity.findFirst({ where: { projectId, code } })) throw new Error("رمز النشاط مستخدم");
      const max = await db.activity.aggregate({ where: { projectId }, _max: { sortOrder: true } });
      const a = await db.activity.create({
        data: { projectId, code, name, ...dates(form), weight, boqItemId: item?.id ?? null, manualPct: item ? null : 0, sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
      await audit(user.id, "create", "Activity", a.id);
    },
    "تمت إضافة النشاط",
  );
}

export async function updateActivity(projectId: string, activityId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "schedule.edit");
      const a = await db.activity.findFirst({ where: { id: activityId, projectId } });
      if (!a) throw new Error("النشاط غير موجود");
      const pctRaw = str(form, "manualPct");
      const pct = pctRaw === "" ? null : num(form, "manualPct") / 100;
      if (pct !== null && (pct < 0 || pct > 1)) throw new Error("نسبة الإنجاز بين 0 و100");
      await db.activity.update({
        where: { id: a.id },
        data: { ...dates(form), ...(a.boqItemId ? {} : { manualPct: pct ?? a.manualPct }) },
      });
      await audit(user.id, "update", "Activity", a.id);
    },
    "تم تحديث النشاط",
  );
}

export async function deleteActivity(projectId: string, activityId: string) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "schedule.edit");
      const a = await db.activity.findFirst({ where: { id: activityId, projectId } });
      if (!a) throw new Error("النشاط غير موجود");
      await db.activity.delete({ where: { id: a.id } });
      await audit(user.id, "delete", "Activity", a.id);
    },
    "تم حذف النشاط",
  );
}
