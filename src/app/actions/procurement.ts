"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { PO_APPROVAL_LIMIT } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";
import { postGoodsReceipt } from "@/lib/accounting";
import { receiveIntoWarehouse } from "@/lib/stores";
import { compareQuotes, initialPoStatus, receiptStatus } from "@/lib/procurement";

const base = (projectId: string) => `/projects/${projectId}/procurement`;
const prPath = (projectId: string, prId: string) => `${base(projectId)}/pr/${prId}`;
const poPath = (projectId: string, poId: string) => `${base(projectId)}/po/${poId}`;
const LINES = 8;

export async function createPr(projectId: string, form: FormData) {
  await runAction(base(projectId), async () => {
    const { user } = await requireProjectAccess(projectId, "pr.create");
    const title = str(form, "title");
    if (!title) throw new Error("عنوان الطلب مطلوب");
    const lines = [];
    for (let i = 0; i < LINES; i++) {
      const description = str(form, `desc_${i}`);
      const quantity = num(form, `qty_${i}`);
      if (description && quantity > 0) lines.push({ description, unit: str(form, `unit_${i}`) || "عدد", quantity });
    }
    if (!lines.length) throw new Error("أضف سطرا واحدا على الأقل بوصف وكمية");
    const required = str(form, "requiredDate");
    const max = await db.purchaseRequest.aggregate({ where: { projectId }, _max: { number: true } });
    const pr = await db.purchaseRequest.create({
      data: {
        projectId,
        number: (max._max.number ?? 0) + 1,
        title,
        requiredDate: required ? parseDay(required) : null,
        costCodeId: str(form, "costCodeId") || null,
        submittalId: str(form, "submittalId") || null,
        createdById: user.id,
        lines: { create: lines },
      },
    });
    await audit(user.id, "create", "PurchaseRequest", pr.id);
    return `${prPath(projectId, pr.id)}?notice=${encodeURIComponent("تم حفظ طلب الشراء كمسودة")}`;
  });
}

export async function submitPr(projectId: string, prId: string) {
  await runAction(
    prPath(projectId, prId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "pr.create");
      const pr = await db.purchaseRequest.findFirst({ where: { id: prId, projectId }, include: { submittal: true } });
      if (!pr || pr.status !== "DRAFT") throw new Error("يمكن رفع المسودة فقط");
      // لا شراء لمادة قبل اعتمادها فنيا من الاستشاري
      if (pr.submittal && !["A", "B"].includes(pr.submittal.status)) {
        throw new Error(`المادة مرتبطة بـ Submittal رقم ${pr.submittal.number} غير معتمد بعد`);
      }
      await db.purchaseRequest.update({ where: { id: prId }, data: { status: "SUBMITTED" } });
      await audit(user.id, "submit", "PurchaseRequest", prId);
    },
    "تم رفع الطلب لمدير المشروع",
  );
}

export async function reviewPr(projectId: string, prId: string, decision: "APPROVED" | "REJECTED") {
  await runAction(
    prPath(projectId, prId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "pr.approve");
      const pr = await db.purchaseRequest.findFirst({ where: { id: prId, projectId } });
      if (!pr || pr.status !== "SUBMITTED") throw new Error("الطلب ليس بانتظار الاعتماد");
      await db.purchaseRequest.update({ where: { id: prId }, data: { status: decision, approvedById: user.id } });
      await audit(user.id, decision.toLowerCase(), "PurchaseRequest", prId);
    },
    decision === "APPROVED" ? "تم اعتماد الطلب، يمكن للمشتريات طلب العروض" : "تم رفض الطلب",
  );
}

export async function addQuotation(projectId: string, prId: string, form: FormData) {
  await runAction(
    prPath(projectId, prId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "po.manage");
      const pr = await db.purchaseRequest.findFirst({ where: { id: prId, projectId }, include: { lines: true } });
      if (!pr || pr.status !== "APPROVED") throw new Error("العروض تُسجل على طلب معتمد فقط");
      const name = str(form, "supplier");
      if (!name) throw new Error("اسم المورد مطلوب");
      const category = str(form, "category") || "E1";
      const supplier =
        (await db.party.findFirst({ where: { name, type: { in: ["SUPPLIER", "SUBCONTRACTOR"] } } })) ??
        (await db.party.create({ data: { name, type: "SUPPLIER", category } }));
      const lines = pr.lines
        .map((l) => ({ prLineId: l.id, raw: str(form, `price_${l.id}`) }))
        .filter((l) => l.raw !== "")
        .map((l) => ({ prLineId: l.prLineId, unitPrice: num(form, `price_${l.prLineId}`) }));
      if (!lines.length) throw new Error("أدخل سعرا لبند واحد على الأقل");
      const days = str(form, "deliveryDays");
      const q = await db.quotation.create({
        data: {
          requestId: prId,
          supplierId: supplier.id,
          deliveryDays: days ? Math.round(num(form, "deliveryDays")) : null,
          notes: str(form, "notes") || null,
          lines: { create: lines },
        },
      });
      await audit(user.id, "create", "Quotation", q.id, { supplier: name });
    },
    "تم تسجيل العرض",
  );
}

export async function createPoFromQuote(projectId: string, prId: string, quotationId: string, form: FormData) {
  await runAction(prPath(projectId, prId), async () => {
    const { user } = await requireProjectAccess(projectId, "po.manage");
    const pr = await db.purchaseRequest.findFirst({
      where: { id: prId, projectId },
      include: { lines: true, quotations: { include: { lines: true } } },
    });
    if (!pr || pr.status !== "APPROVED") throw new Error("لا يمكن إصدار أمر شراء لهذا الطلب");
    const quote = pr.quotations.find((q) => q.id === quotationId);
    if (!quote) throw new Error("العرض غير موجود");
    const { totals, lowest } = compareQuotes(pr.lines, pr.quotations);
    const t = totals.find((x) => x.id === quotationId)!;
    if (!t.complete) throw new Error("العرض لا يغطي كل بنود الطلب");
    // اختيار غير الأقل سعرا يحتاج تبريرا مكتوبا
    const justification = str(form, "justification");
    if (lowest && lowest !== quotationId && !justification) throw new Error("هذا ليس أقل عرض: اكتب سبب الاختيار");

    const prices = new Map(quote.lines.map((l) => [l.prLineId, l.unitPrice]));
    const max = await db.purchaseOrder.aggregate({ where: { projectId }, _max: { number: true } });
    const status = initialPoStatus(t.total, PO_APPROVAL_LIMIT);
    const po = await db.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          projectId,
          number: (max._max.number ?? 0) + 1,
          requestId: prId,
          supplierId: quote.supplierId,
          costCodeId: pr.costCodeId,
          total: t.total,
          status,
          createdById: user.id,
          lines: {
            create: pr.lines.map((l) => ({ prLineId: l.id, description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: prices.get(l.id)! })),
          },
        },
      });
      await tx.purchaseRequest.update({ where: { id: prId }, data: { status: "ORDERED" } });
      return created;
    });
    await audit(user.id, "create", "PurchaseOrder", po.id, { total: t.total, justification: justification || undefined });
    const msg = status === "PENDING_APPROVAL" ? "تم إنشاء أمر الشراء وهو بانتظار اعتماد الإدارة لتجاوزه حد الصلاحية" : "تم إصدار أمر الشراء";
    return `${poPath(projectId, po.id)}?notice=${encodeURIComponent(msg)}`;
  });
}

export async function approvePo(projectId: string, poId: string) {
  await runAction(
    poPath(projectId, poId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "po.approveHigh");
      const po = await db.purchaseOrder.findFirst({ where: { id: poId, projectId } });
      if (!po || po.status !== "PENDING_APPROVAL") throw new Error("أمر الشراء ليس بانتظار الاعتماد");
      await db.purchaseOrder.update({ where: { id: poId }, data: { status: "ISSUED", approvedById: user.id } });
      await audit(user.id, "approve", "PurchaseOrder", poId);
    },
    "تم اعتماد أمر الشراء وإصداره",
  );
}

export async function cancelPo(projectId: string, poId: string) {
  await runAction(
    poPath(projectId, poId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "po.manage");
      const po = await db.purchaseOrder.findFirst({ where: { id: poId, projectId }, include: { receipts: true } });
      if (!po || !["PENDING_APPROVAL", "ISSUED"].includes(po.status) || po.receipts.length) {
        throw new Error("لا يمكن إلغاء أمر شراء تم الاستلام عليه");
      }
      await db.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED" } });
      await db.purchaseRequest.update({ where: { id: po.requestId }, data: { status: "APPROVED" } });
      await audit(user.id, "cancel", "PurchaseOrder", poId);
    },
    "تم إلغاء أمر الشراء وإعادة الطلب للعروض",
  );
}

export async function receiveGoods(projectId: string, poId: string, form: FormData) {
  await runAction(
    poPath(projectId, poId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "grn.create");
      const po = await db.purchaseOrder.findFirst({ where: { id: poId, projectId }, include: { lines: { include: { receipts: true } } } });
      if (!po || !["ISSUED", "PARTIAL"].includes(po.status)) throw new Error("لا يمكن الاستلام على هذا الأمر");
      const warehouseId = str(form, "warehouseId") || null;
      if (warehouseId && !(await db.warehouse.findUnique({ where: { id: warehouseId } }))) throw new Error("المستودع غير موجود");
      const lines: { poLineId: string; quantity: number }[] = [];
      for (const l of po.lines) {
        const qty = num(form, `rcv_${l.id}`);
        if (qty < 0) throw new Error("لا يمكن إدخال كمية سالبة");
        const already = l.receipts.reduce((s, r) => s + r.quantity, 0);
        if (already + qty > l.quantity + 1e-9) throw new Error(`الكمية المستلمة من "${l.description}" تتجاوز المطلوب`);
        if (qty > 0) lines.push({ poLineId: l.id, quantity: qty });
      }
      if (!lines.length) throw new Error("أدخل كمية مستلمة واحدة على الأقل");
      const date = str(form, "date");
      const received = new Map(lines.map((l) => [l.poLineId, l.quantity]));
      const status = receiptStatus(
        po.lines.map((l) => ({ ordered: l.quantity, received: l.receipts.reduce((s, r) => s + r.quantity, 0) + (received.get(l.id) ?? 0) })),
      );
      // الاستلام يثبت التكلفة على المشروع والمستحق للمورد في نفس المعاملة
      await db.$transaction(async (tx) => {
        const grnDate = parseDay(date || new Date().toISOString().slice(0, 10));
        const deliveryNote = str(form, "deliveryNote") || null;
        const grn = await tx.goodsReceipt.create({
          data: { orderId: poId, date: grnDate, deliveryNote, warehouseId, createdById: user.id, lines: { create: lines } },
        });
        await tx.purchaseOrder.update({ where: { id: poId }, data: { status } });
        if (warehouseId) {
          const byId = new Map(po.lines.map((l) => [l.id, l]));
          await receiveIntoWarehouse(
            tx,
            { grnId: grn.id, warehouseId, date: grnDate, projectId, costCodeId: po.costCodeId, userId: user.id, reference: deliveryNote },
            lines.map((l) => ({ ...byId.get(l.poLineId)!, quantity: l.quantity })),
          );
        }
        await postGoodsReceipt(tx, grn.id, user.id);
      });
      await audit(user.id, "receive", "PurchaseOrder", poId, { lines: lines.length });
    },
    "تم تسجيل الاستلام",
  );
}
