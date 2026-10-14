"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";

const path = (projectId: string) => `/projects/${projectId}/technical`;
const TYPES = ["MATERIAL", "SHOP_DRAWING", "METHOD_STATEMENT"];
const DEFAULT_REVIEW_DAYS = 14;

export async function createSubmittal(projectId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "tech.manage");
      const type = str(form, "type");
      const title = str(form, "title");
      if (!TYPES.includes(type) || !title) throw new Error("النوع والعنوان مطلوبان");
      const max = await db.submittal.aggregate({ where: { projectId }, _max: { number: true } });
      const s = await db.submittal.create({
        data: { projectId, number: (max._max.number ?? 0) + 1, type, title, boqItemId: str(form, "boqItemId") || null, createdById: user.id },
      });
      await audit(user.id, "create", "Submittal", s.id);
    },
    "تم إنشاء الـ Submittal كمسودة",
  );
}

export async function submitSubmittal(projectId: string, submittalId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "tech.manage");
      const s = await db.submittal.findFirst({ where: { id: submittalId, projectId } });
      if (!s || s.status !== "DRAFT") throw new Error("يمكن رفع المسودة فقط");
      const due = str(form, "dueDate");
      const dueDate = due ? parseDay(due) : new Date(Date.now() + DEFAULT_REVIEW_DAYS * 864e5);
      await db.submittal.update({ where: { id: submittalId }, data: { status: "SUBMITTED", submittedAt: new Date(), dueDate } });
      await audit(user.id, "submit", "Submittal", submittalId);
    },
    "تم تسجيل رفع الـ Submittal للاستشاري",
  );
}

export async function respondSubmittal(projectId: string, submittalId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "tech.manage");
      const code = str(form, "code");
      if (!["A", "B", "C", "D"].includes(code)) throw new Error("اختر رد الاستشاري");
      const s = await db.submittal.findFirst({ where: { id: submittalId, projectId } });
      if (!s || s.status !== "SUBMITTED") throw new Error("الـ Submittal ليس بانتظار الرد");
      await db.submittal.update({ where: { id: submittalId }, data: { status: code, comment: str(form, "comment") || null, respondedAt: new Date() } });
      await audit(user.id, `respond-${code}`, "Submittal", submittalId);
    },
    "تم تسجيل رد الاستشاري",
  );
}

// C أو D: نفتح إصدارا جديدا بنفس الرقم
export async function reviseSubmittal(projectId: string, submittalId: string) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "tech.manage");
      const s = await db.submittal.findFirst({ where: { id: submittalId, projectId } });
      if (!s || !["C", "D"].includes(s.status)) throw new Error("الإصدار الجديد فقط بعد رد C أو D");
      const latest = await db.submittal.findFirst({ where: { projectId, number: s.number }, orderBy: { revision: "desc" } });
      if (latest!.id !== s.id) throw new Error("يوجد إصدار أحدث لهذا الـ Submittal");
      const rev = await db.submittal.create({
        data: { projectId, number: s.number, revision: s.revision + 1, type: s.type, title: s.title, boqItemId: s.boqItemId, createdById: user.id },
      });
      await audit(user.id, "revise", "Submittal", rev.id, { revision: rev.revision });
    },
    "تم فتح إصدار جديد كمسودة",
  );
}

export async function createRfi(projectId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "tech.manage");
      const subject = str(form, "subject");
      const question = str(form, "question");
      if (!subject || !question) throw new Error("الموضوع والسؤال مطلوبان");
      const due = str(form, "dueDate");
      const max = await db.rfi.aggregate({ where: { projectId }, _max: { number: true } });
      const rfi = await db.rfi.create({
        data: {
          projectId,
          number: (max._max.number ?? 0) + 1,
          subject,
          question,
          dueDate: due ? parseDay(due) : new Date(Date.now() + 7 * 864e5),
          createdById: user.id,
        },
      });
      await audit(user.id, "create", "Rfi", rfi.id);
    },
    "تم تسجيل الاستفسار",
  );
}

export async function answerRfi(projectId: string, rfiId: string, form: FormData) {
  await runAction(
    path(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "tech.manage");
      const answer = str(form, "answer");
      if (!answer) throw new Error("اكتب رد الاستشاري");
      const rfi = await db.rfi.findFirst({ where: { id: rfiId, projectId } });
      if (!rfi || rfi.status !== "OPEN") throw new Error("الاستفسار ليس مفتوحا");
      await db.rfi.update({ where: { id: rfiId }, data: { status: "ANSWERED", answer, answeredAt: new Date() } });
      await audit(user.id, "answer", "Rfi", rfiId);
    },
    "تم تسجيل رد الاستشاري",
  );
}
