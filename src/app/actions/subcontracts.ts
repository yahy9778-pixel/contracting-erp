"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";
import { calculateIpc, capSubcontractQty } from "@/lib/ipc";
import { billableQuantities } from "@/lib/ipc-service";

const base = (projectId: string) => `/projects/${projectId}/subcontracts`;
const scPath = (projectId: string, scId: string) => `${base(projectId)}/${scId}`;
const ROWS = 8;
const CATEGORIES = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11"];

export async function createSubcontract(projectId: string, form: FormData) {
  await runAction(base(projectId), async () => {
    const { user } = await requireProjectAccess(projectId, "sub.manage");
    const name = str(form, "subcontractor");
    const category = str(form, "category");
    const scope = str(form, "scope");
    if (!name || !scope || !CATEGORIES.includes(category)) throw new Error("اسم المقاول وتخصصه ونطاق العمل مطلوبة");
    const lines = new Map<string, { boqItemId: string; quantity: number; rate: number }>();
    for (let i = 0; i < ROWS; i++) {
      const boqItemId = str(form, `item_${i}`);
      if (!boqItemId) continue;
      const quantity = num(form, `qty_${i}`);
      const rate = num(form, `rate_${i}`);
      if (quantity <= 0 || rate <= 0) throw new Error("كل بند يحتاج كمية وسعر أكبر من صفر");
      if (lines.has(boqItemId)) throw new Error("البند مكرر في نفس العقد");
      lines.set(boqItemId, { boqItemId, quantity, rate });
    }
    if (!lines.size) throw new Error("أضف بندا واحدا على الأقل من جدول الكميات");
    const valid = await db.boqItem.count({ where: { projectId, id: { in: [...lines.keys()] } } });
    if (valid !== lines.size) throw new Error("بند غير موجود في المشروع");

    const party =
      (await db.party.findFirst({ where: { name, type: "SUBCONTRACTOR" } })) ??
      (await db.party.create({ data: { name, type: "SUBCONTRACTOR", category } }));
    const max = await db.subcontract.aggregate({ where: { projectId }, _max: { number: true } });
    const sc = await db.subcontract.create({
      data: {
        projectId,
        number: (max._max.number ?? 0) + 1,
        subcontractorId: party.id,
        scope,
        retentionPct: num(form, "retentionPct", 10),
        vatPct: num(form, "vatPct", 15),
        lines: { create: [...lines.values()] },
      },
    });
    await audit(user.id, "create", "Subcontract", sc.id);
    return `${scPath(projectId, sc.id)}?notice=${encodeURIComponent("تم تسجيل عقد الباطن")}`;
  });
}

export async function createSubCertificate(projectId: string, scId: string, form: FormData) {
  await runAction(scPath(projectId, scId), async () => {
    const { user } = await requireProjectAccess(projectId, "sub.manage");
    const sc = await db.subcontract.findFirst({
      where: { id: scId, projectId },
      include: { lines: true, certificates: { orderBy: { number: "desc" }, include: { lines: true } } },
    });
    if (!sc) throw new Error("العقد غير موجود");
    if (sc.certificates.some((c) => c.status === "DRAFT")) throw new Error("يوجد مستخلص مسودة لهذا المقاول، اعتمده أو احذفه أولا");
    const periodTo = parseDay(str(form, "periodTo") || new Date().toISOString().slice(0, 10));
    const previous = sc.certificates[0];
    if (previous && periodTo <= previous.periodTo) throw new Error("نهاية الفترة يجب أن تكون بعد المستخلص السابق");

    const { billable } = await billableQuantities(projectId, periodTo);
    const prevQty = new Map(previous?.lines.map((l) => [l.lineId, l.cumulativeQty]) ?? []);
    const capped: string[] = [];
    const inputs = sc.lines.map((l) => {
      const requested = num(form, `cum_${l.id}`, prevQty.get(l.id) ?? 0);
      const c = capSubcontractQty(requested, billable.get(l.boqItemId) ?? 0, l.quantity);
      if (c.capped) capped.push(l.id);
      return { line: l, cumulative: Math.max(c.quantity, prevQty.get(l.id) ?? 0) };
    });
    if (capped.length) throw new Error("بعض الكميات تتجاوز ما استُلم منا من المالك أو كمية عقد الباطن، راجع الحد الأقصى بجانب كل بند");

    const result = calculateIpc(
      inputs.map((i) => ({ boqItemId: i.line.id, rate: i.line.rate, contractQty: i.line.quantity, executedToDate: i.cumulative, previousQty: prevQty.get(i.line.id) ?? 0 })),
      { contractValue: 0, retentionPct: sc.retentionPct, advanceAmount: 0, vatPct: sc.vatPct, advanceRecoveredBefore: 0, previousGross: previous?.grossCumulative ?? 0 },
    );
    if (result.currentGross <= 0) throw new Error("لا توجد كميات جديدة منذ المستخلص السابق");

    const cert = await db.subcontractCertificate.create({
      data: {
        subcontractId: scId,
        number: (previous?.number ?? 0) + 1,
        periodTo,
        grossCumulative: result.grossCumulative,
        previousGross: result.previousGross,
        currentGross: result.currentGross,
        retention: result.retention,
        vat: result.vat,
        netPayable: result.netPayable,
        lines: {
          create: result.lines.map((l) => ({ lineId: l.boqItemId, previousQty: l.previousQty, currentQty: l.currentQty, cumulativeQty: l.cumulativeQty, rate: l.rate })),
        },
      },
    });
    await audit(user.id, "create", "SubcontractCertificate", cert.id);
    return `${scPath(projectId, scId)}?notice=${encodeURIComponent(`تم إعداد مستخلص الباطن رقم ${cert.number}`)}`;
  });
}

export async function moveSubCertificate(projectId: string, scId: string, certId: string, to: "APPROVED" | "PAID") {
  await runAction(
    scPath(projectId, scId),
    async () => {
      const { user } = await requireProjectAccess(projectId, to === "APPROVED" ? "sub.approve" : "sub.markPaid");
      const cert = await db.subcontractCertificate.findFirst({ where: { id: certId, subcontractId: scId, subcontract: { projectId } } });
      const from = to === "APPROVED" ? "DRAFT" : "APPROVED";
      if (!cert || cert.status !== from) throw new Error("لا يمكن تنفيذ الإجراء على المستخلص في حالته الحالية");
      await db.subcontractCertificate.update({ where: { id: certId }, data: { status: to } });
      await audit(user.id, to.toLowerCase(), "SubcontractCertificate", certId);
    },
    to === "APPROVED" ? "تم اعتماد مستخلص الباطن" : "تم تسجيل الدفع",
  );
}

export async function deleteSubCertificate(projectId: string, scId: string, certId: string) {
  await runAction(
    scPath(projectId, scId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "sub.manage");
      const cert = await db.subcontractCertificate.findFirst({ where: { id: certId, subcontractId: scId, subcontract: { projectId } } });
      if (!cert || cert.status !== "DRAFT") throw new Error("يمكن حذف المسودة فقط");
      await db.subcontractCertificate.delete({ where: { id: certId } });
      await audit(user.id, "delete", "SubcontractCertificate", certId);
    },
    "تم حذف المسودة",
  );
}
