"use server";

import { db } from "@/lib/db";
import { requireProjectAccess, type SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";
import { runDailyReportAgent } from "@/lib/agents/daily-report";

const ROWS = 8;

// قراءة سطور التقرير من النموذج
async function readLines(projectId: string, form: FormData) {
  const manpower = [];
  const equipment = [];
  for (let i = 0; i < ROWS; i++) {
    const trade = str(form, `trade_${i}`);
    const count = num(form, `count_${i}`);
    if (trade && count > 0) manpower.push({ trade, count: Math.round(count) });
    const name = str(form, `eq_${i}`);
    const eqCount = num(form, `eqcount_${i}`);
    if (name && eqCount > 0) {
      const hours = str(form, `eqhours_${i}`);
      equipment.push({ name, count: Math.round(eqCount), hours: hours ? num(form, `eqhours_${i}`) : null });
    }
  }
  const items = await db.boqItem.findMany({ where: { projectId }, select: { id: true } });
  const progress = [];
  for (const item of items) {
    const quantity = num(form, `qty_${item.id}`);
    if (quantity < 0) throw new Error("لا يمكن إدخال كمية سالبة");
    if (quantity > 0) progress.push({ boqItemId: item.id, quantity, location: str(form, `loc_${item.id}`) || null });
  }
  return { manpower, equipment, progress };
}

function canEditReport(user: SessionUser, report: { status: string; createdById: string }) {
  if (!["DRAFT", "REJECTED"].includes(report.status)) return false;
  return report.createdById === user.id || can(user.role, "report.approve");
}

export async function createReport(projectId: string, form: FormData) {
  const base = `/projects/${projectId}/reports`;
  await runAction(base, async () => {
    const { user } = await requireProjectAccess(projectId, "report.create");
    const dateStr = str(form, "date");
    if (!dateStr) throw new Error("تاريخ التقرير مطلوب");
    const date = parseDay(dateStr);
    if (await db.dailyReport.findUnique({ where: { projectId_date: { projectId, date } } })) {
      throw new Error(`يوجد تقرير لهذا المشروع بتاريخ ${dateStr}`);
    }
    const lines = await readLines(projectId, form);
    const report = await db.dailyReport.create({
      data: {
        projectId,
        date,
        weather: str(form, "weather") || null,
        notes: str(form, "notes") || null,
        issues: str(form, "issues") || null,
        createdById: user.id,
        manpower: { create: lines.manpower },
        equipment: { create: lines.equipment },
        progress: { create: lines.progress },
      },
    });
    await audit(user.id, "create", "DailyReport", report.id);
    return `${base}/${report.id}?notice=${encodeURIComponent("تم حفظ التقرير كمسودة")}`;
  });
}

export async function updateReport(projectId: string, reportId: string, form: FormData) {
  const path = `/projects/${projectId}/reports/${reportId}`;
  await runAction(
    path,
    async () => {
      const { user } = await requireProjectAccess(projectId, "report.create");
      const report = await db.dailyReport.findFirst({ where: { id: reportId, projectId } });
      if (!report) throw new Error("التقرير غير موجود");
      if (!canEditReport(user, report)) throw new Error("لا يمكن تعديل هذا التقرير");
      const lines = await readLines(projectId, form);
      await db.$transaction([
        db.manpowerEntry.deleteMany({ where: { reportId } }),
        db.equipmentEntry.deleteMany({ where: { reportId } }),
        db.progressEntry.deleteMany({ where: { reportId } }),
        db.dailyReport.update({
          where: { id: reportId },
          data: {
            weather: str(form, "weather") || null,
            notes: str(form, "notes") || null,
            issues: str(form, "issues") || null,
            status: "DRAFT",
            manpower: { create: lines.manpower },
            equipment: { create: lines.equipment },
            progress: { create: lines.progress },
          },
        }),
      ]);
      await audit(user.id, "update", "DailyReport", reportId);
    },
    "تم حفظ التعديلات",
  );
}

export async function submitReport(projectId: string, reportId: string) {
  const path = `/projects/${projectId}/reports/${reportId}`;
  await runAction(
    path,
    async () => {
      const { user } = await requireProjectAccess(projectId, "report.create");
      const report = await db.dailyReport.findFirst({ where: { id: reportId, projectId }, include: { _count: { select: { progress: true, manpower: true } } } });
      if (!report || !canEditReport(user, report)) throw new Error("لا يمكن رفع هذا التقرير");
      if (!report._count.progress && !report._count.manpower) throw new Error("التقرير فارغ: أضف كميات منفذة أو عمالة قبل الرفع");
      await db.dailyReport.update({ where: { id: reportId }, data: { status: "SUBMITTED" } });
      await audit(user.id, "submit", "DailyReport", reportId);
    },
    "تم رفع التقرير لمدير المشروع للاعتماد",
  );
}

export async function reviewReport(projectId: string, reportId: string, decision: "APPROVED" | "REJECTED") {
  const path = `/projects/${projectId}/reports/${reportId}`;
  await runAction(
    path,
    async () => {
      const { user } = await requireProjectAccess(projectId, "report.approve");
      const report = await db.dailyReport.findFirst({ where: { id: reportId, projectId } });
      if (!report || report.status !== "SUBMITTED") throw new Error("التقرير ليس بانتظار الاعتماد");
      await db.dailyReport.update({
        where: { id: reportId },
        data: { status: decision, approvedById: user.id, approvedAt: new Date() },
      });
      await audit(user.id, decision === "APPROVED" ? "approve" : "reject", "DailyReport", reportId);
    },
    decision === "APPROVED" ? "تم اعتماد التقرير وأضيفت كمياته للمنفذ" : "تم رفض التقرير وإعادته للمهندس",
  );
}

export async function deleteReport(projectId: string, reportId: string) {
  await runAction(`/projects/${projectId}/reports/${reportId}`, async () => {
    const { user } = await requireProjectAccess(projectId, "report.create");
    const report = await db.dailyReport.findFirst({ where: { id: reportId, projectId } });
    if (!report || !canEditReport(user, report)) throw new Error("لا يمكن حذف هذا التقرير");
    await db.dailyReport.delete({ where: { id: reportId } });
    await audit(user.id, "delete", "DailyReport", reportId);
    return `/projects/${projectId}/reports?notice=${encodeURIComponent("تم حذف المسودة")}`;
  });
}

// وكيل التقرير اليومي: نص حر من الموقع ← مسودة تقرير منظمة
export async function draftReportWithAgent(projectId: string, form: FormData) {
  const base = `/projects/${projectId}/reports`;
  await runAction(base, async () => {
    const { user } = await requireProjectAccess(projectId, "report.create");
    const text = str(form, "text");
    const dateStr = str(form, "date");
    if (text.length < 10) throw new Error("اكتب وصفا لما تم في الموقع اليوم");
    const items = await db.boqItem.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] });
    if (!items.length) throw new Error("أضف جدول الكميات أولا حتى يطابق الوكيل الأعمال مع البنود");

    let draft;
    try {
      draft = await runDailyReportAgent(text, items.map((i) => ({ itemNo: i.itemNo, description: i.description, unit: i.unit })));
    } catch (e) {
      await db.agentAction.create({
        data: { agent: "daily-report", userId: user.id, projectId, input: text, output: String(e), status: "ERROR" },
      });
      throw e;
    }

    const date = parseDay(dateStr || draft.date || new Date().toISOString().slice(0, 10));
    if (await db.dailyReport.findUnique({ where: { projectId_date: { projectId, date } } })) {
      throw new Error(`يوجد تقرير بتاريخ ${date.toISOString().slice(0, 10)}، اختر تاريخا آخر`);
    }
    const byNo = new Map(items.map((i) => [i.itemNo, i.id]));
    const issues = [...draft.issues, ...draft.unmatched.map((u) => `غير مطابق لبند: ${u}`)];

    const report = await db.dailyReport.create({
      data: {
        projectId,
        date,
        weather: draft.weather,
        notes: draft.notes,
        issues: issues.length ? issues.join("\n") : null,
        source: "AGENT",
        rawText: text,
        createdById: user.id,
        manpower: { create: draft.manpower.filter((m) => m.count > 0) },
        equipment: { create: draft.equipment.filter((m) => m.count > 0) },
        progress: {
          create: draft.progress.map((p) => ({ boqItemId: byNo.get(p.itemNo)!, quantity: p.quantity, location: p.location })),
        },
      },
    });
    await db.agentAction.create({
      data: { agent: "daily-report", userId: user.id, projectId, input: text, output: JSON.stringify(draft), status: "SUCCESS" },
    });
    await audit(user.id, "agent-draft", "DailyReport", report.id);
    return `${base}/${report.id}?notice=${encodeURIComponent("جهز الوكيل مسودة التقرير، راجعها ثم ارفعها للاعتماد")}`;
  });
}
