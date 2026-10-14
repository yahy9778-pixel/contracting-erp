"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";
import { createIpc } from "@/lib/ipc-service";
import type { Permission } from "@/lib/permissions";

export async function generateIpc(projectId: string, form: FormData) {
  const base = `/projects/${projectId}/ipcs`;
  await runAction(base, async () => {
    const { user } = await requireProjectAccess(projectId, "ipc.create");
    const periodTo = str(form, "periodTo");
    if (!periodTo) throw new Error("حدد تاريخ نهاية الفترة");
    const draft = await db.paymentCertificate.findFirst({ where: { projectId, status: "DRAFT" } });
    if (draft) throw new Error(`يوجد مستخلص رقم ${draft.number} ما زال مسودة، أكمله أو احذفه أولا`);
    const ipc = await createIpc(projectId, parseDay(periodTo));
    await audit(user.id, "create", "PaymentCertificate", ipc.id, { number: ipc.number });
    return `${base}/${ipc.id}?notice=${encodeURIComponent("تم إعداد المستخلص من الكميات المعتمدة")}`;
  });
}

const TRANSITIONS: Record<string, { from: string; permission: Permission; notice: string }> = {
  SUBMITTED: { from: "DRAFT", permission: "ipc.submit", notice: "تم تسجيل رفع المستخلص للاستشاري" },
  APPROVED: { from: "SUBMITTED", permission: "ipc.approve", notice: "تم تسجيل اعتماد الاستشاري" },
  PAID: { from: "APPROVED", permission: "ipc.markPaid", notice: "تم تسجيل التحصيل" },
};

export async function moveIpc(projectId: string, ipcId: string, to: "SUBMITTED" | "APPROVED" | "PAID", form: FormData) {
  const path = `/projects/${projectId}/ipcs/${ipcId}`;
  const t = TRANSITIONS[to];
  await runAction(
    path,
    async () => {
      const { user } = await requireProjectAccess(projectId, t.permission);
      const ipc = await db.paymentCertificate.findFirst({ where: { id: ipcId, projectId } });
      if (!ipc || ipc.status !== t.from) throw new Error("لا يمكن تنفيذ هذا الإجراء على المستخلص في حالته الحالية");
      const approvedAmount = to === "APPROVED" ? num(form, "approvedAmount", ipc.netPayable) : undefined;
      await db.paymentCertificate.update({
        where: { id: ipcId },
        data: { status: to, ...(approvedAmount !== undefined ? { approvedAmount } : {}), ...(to === "PAID" ? { paidAt: new Date() } : {}) },
      });
      await audit(user.id, to.toLowerCase(), "PaymentCertificate", ipcId, approvedAmount !== undefined ? { approvedAmount } : undefined);
    },
    t.notice,
  );
}

export async function deleteIpc(projectId: string, ipcId: string) {
  await runAction(`/projects/${projectId}/ipcs/${ipcId}`, async () => {
    const { user } = await requireProjectAccess(projectId, "ipc.create");
    const ipc = await db.paymentCertificate.findFirst({ where: { id: ipcId, projectId } });
    if (!ipc || ipc.status !== "DRAFT") throw new Error("يمكن حذف المسودة فقط");
    const latest = await db.paymentCertificate.findFirst({ where: { projectId }, orderBy: { number: "desc" } });
    if (latest?.id !== ipcId) throw new Error("يمكن حذف آخر مستخلص فقط");
    await db.paymentCertificate.delete({ where: { id: ipcId } });
    await audit(user.id, "delete", "PaymentCertificate", ipcId);
    return `/projects/${projectId}/ipcs?notice=${encodeURIComponent("تم حذف المسودة")}`;
  });
}
