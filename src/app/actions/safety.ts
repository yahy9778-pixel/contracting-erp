"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay, todayStr } from "@/lib/format";
import { INCIDENT_KINDS, OBS_CATEGORIES, SEVERITY_DAYS } from "@/lib/safety";

const base = (projectId: string) => `/projects/${projectId}/safety`;

export async function reportIncident(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "hse.report");
      const kind = str(form, "kind");
      const description = str(form, "description");
      if (!(kind in INCIDENT_KINDS) || !description) throw new Error("حدد نوع الحادث ووصفه");
      const lostDays = num(form, "lostDays");
      if (lostDays < 0) throw new Error("أيام الغياب لا تكون سالبة");
      if (kind === "LOST_TIME" && lostDays <= 0) throw new Error("الإصابة المضيعة للوقت تحتاج عدد أيام الغياب");
      const max = await db.safetyIncident.aggregate({ where: { projectId }, _max: { number: true } });
      const i = await db.safetyIncident.create({
        data: {
          projectId,
          number: (max._max.number ?? 0) + 1,
          date: parseDay(str(form, "date") || todayStr()),
          kind,
          location: str(form, "location") || null,
          description,
          injured: str(form, "injured") || null,
          lostDays,
          createdById: user.id,
        },
      });
      await audit(user.id, "create", "SafetyIncident", i.id, { kind });
    },
    "تم تسجيل الحادث، ويحتاج تحقيقا في السبب الجذري قبل إغلاقه",
  );
}

export async function closeIncident(projectId: string, incidentId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "hse.manage");
      const rootCause = str(form, "rootCause");
      const correctiveAction = str(form, "correctiveAction");
      if (!rootCause || !correctiveAction) throw new Error("الإغلاق يحتاج السبب الجذري والإجراء التصحيحي");
      const i = await db.safetyIncident.findFirst({ where: { id: incidentId, projectId, status: "OPEN" } });
      if (!i) throw new Error("الحادث مغلق");
      await db.safetyIncident.update({ where: { id: i.id }, data: { rootCause, correctiveAction, status: "CLOSED", closedAt: new Date() } });
      await audit(user.id, "close", "SafetyIncident", i.id);
    },
    "تم إغلاق التحقيق",
  );
}

export async function createObservation(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "hse.report");
      const category = str(form, "category");
      const severity = str(form, "severity");
      const description = str(form, "description");
      const assignedTo = str(form, "assignedTo");
      if (!(category in OBS_CATEGORIES) || !(severity in SEVERITY_DAYS) || !description || !assignedTo) throw new Error("أكمل الملاحظة: الفئة والخطورة والوصف والمسؤول");
      const date = parseDay(str(form, "date") || todayStr());
      const due = str(form, "dueDate");
      const max = await db.safetyObservation.aggregate({ where: { projectId }, _max: { number: true } });
      const o = await db.safetyObservation.create({
        data: {
          projectId,
          number: (max._max.number ?? 0) + 1,
          date,
          category,
          severity,
          description,
          assignedTo,
          dueDate: due ? parseDay(due) : new Date(date.getTime() + SEVERITY_DAYS[severity] * 86_400_000),
          createdById: user.id,
        },
      });
      await audit(user.id, "create", "SafetyObservation", o.id);
    },
    "تم تسجيل الملاحظة",
  );
}

export async function closeObservation(projectId: string, obsId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "hse.manage");
      const closureNote = str(form, "closureNote");
      if (!closureNote) throw new Error("اكتب ما تم تصحيحه");
      const o = await db.safetyObservation.findFirst({ where: { id: obsId, projectId, status: "OPEN" } });
      if (!o) throw new Error("الملاحظة مغلقة");
      await db.safetyObservation.update({ where: { id: o.id }, data: { status: "CLOSED", closureNote, closedAt: new Date() } });
      await audit(user.id, "close", "SafetyObservation", o.id);
    },
    "تم إغلاق الملاحظة",
  );
}

export async function recordTalk(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "hse.report");
      const topic = str(form, "topic");
      const attendees = Math.round(num(form, "attendees"));
      if (!topic || attendees <= 0) throw new Error("الموضوع وعدد الحضور مطلوبان");
      await db.toolboxTalk.create({ data: { projectId, topic, attendees, date: parseDay(str(form, "date") || todayStr()), createdById: user.id } });
      await audit(user.id, "create", "ToolboxTalk", projectId, { topic });
    },
    "تم تسجيل حديث السلامة",
  );
}
