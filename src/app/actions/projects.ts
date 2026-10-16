"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";

async function findOrCreateParty(name: string, type: "CLIENT" | "CONSULTANT", category: string) {
  const existing = await db.party.findFirst({ where: { name, type } });
  return existing ?? db.party.create({ data: { name, type, category } });
}

export async function createProject(form: FormData) {
  await runAction("/projects/new", async () => {
    const user = await requirePermission("projects.manage");
    const code = str(form, "code");
    const name = str(form, "name");
    const clientName = str(form, "client");
    if (!code || !name || !clientName) throw new Error("رقم المشروع واسمه والمالك حقول مطلوبة");
    if (await db.project.findUnique({ where: { code } })) throw new Error("رقم المشروع مستخدم من قبل");

    const client = await findOrCreateParty(clientName, "CLIENT", "A");
    const consultantName = str(form, "consultant");
    const consultant = consultantName ? await findOrCreateParty(consultantName, "CONSULTANT", "B3") : null;
    const start = str(form, "startDate");
    const end = str(form, "endDate");

    const project = await db.project.create({
      data: {
        code,
        name,
        location: str(form, "location") || null,
        clientId: client.id,
        consultantId: consultant?.id ?? null,
        contractValue: num(form, "contractValue"),
        advanceAmount: num(form, "advanceAmount"),
        retentionPct: num(form, "retentionPct", 10),
        vatPct: num(form, "vatPct", 15),
        requireInspection: form.get("requireInspection") === "on",
        startDate: start ? parseDay(start) : null,
        endDate: end ? parseDay(end) : null,
      },
    });
    await audit(user.id, "create", "Project", project.id, { code, name });
    return `/projects/${project.id}/boq?notice=${encodeURIComponent("تم إنشاء المشروع، أضف الآن جدول الكميات")}`;
  });
}

const PROJECT_STATUSES = ["ACTIVE", "ON_HOLD", "COMPLETED"];

export async function updateProjectStatus(projectId: string, form: FormData) {
  await runAction(
    `/projects/${projectId}`,
    async () => {
      const user = await requirePermission("projects.manage");
      const status = str(form, "status");
      if (!PROJECT_STATUSES.includes(status)) throw new Error("حالة المشروع غير صحيحة");
      const project = await db.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error("المشروع غير موجود");
      if (project.status === status) throw new Error("المشروع على هذه الحالة أصلا");
      await db.project.update({ where: { id: projectId }, data: { status } });
      await audit(user.id, "update_status", "Project", projectId, { from: project.status, to: status });
    },
    "تم تحديث حالة المشروع",
  );
}
