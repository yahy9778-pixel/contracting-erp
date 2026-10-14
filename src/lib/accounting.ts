import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ACC, costAccountFor, ipcApprovalLines, normalBalance, normalizeLines, r2, subCertApprovalLines, type Line } from "./ledger";

type Tx = Prisma.TransactionClient;

type EntryInput = {
  date: Date;
  description: string;
  sourceKey?: string;
  kind?: "AUTO" | "MANUAL";
  projectId?: string | null;
  createdById?: string | null;
  lines: Line[];
};

// ترحيل قيد متوازن. الحدث الواحد لا يُرحَّل مرتين (sourceKey)
export async function postEntry(tx: Tx, input: EntryInput) {
  if (input.sourceKey) {
    const existing = await tx.journalEntry.findUnique({ where: { sourceKey: input.sourceKey } });
    if (existing) return existing;
  }
  const lines = normalizeLines(input.lines);
  const codes = [...new Set(lines.map((l) => l.account))];
  const accounts = await tx.account.findMany({ where: { code: { in: codes } } });
  const ids = new Map(accounts.map((a) => [a.code, a.id]));
  for (const c of codes) if (!ids.has(c)) throw new Error(`الحساب ${c} غير موجود في دليل الحسابات`);
  const max = await tx.journalEntry.aggregate({ _max: { number: true } });
  return tx.journalEntry.create({
    data: {
      number: (max._max.number ?? 0) + 1,
      date: input.date,
      description: input.description,
      sourceKey: input.sourceKey ?? null,
      kind: input.kind ?? "AUTO",
      createdById: input.createdById ?? null,
      lines: {
        create: lines.map((l) => ({
          accountId: ids.get(l.account)!,
          debit: l.debit,
          credit: l.credit,
          projectId: l.projectId === undefined ? (input.projectId ?? null) : l.projectId,
          costCodeId: l.costCodeId ?? null,
          partyId: l.partyId ?? null,
          memo: l.memo ?? null,
        })),
      },
    },
  });
}

export async function cashAccounts() {
  return db.account.findMany({ where: { isCash: true, active: true }, orderBy: { code: "asc" } });
}

// حساب نقدية مختار من نموذج، والافتراضي البنك
export async function cashAccountCode(tx: Tx, value: string | undefined) {
  const code = value || ACC.BANK;
  const acc = await tx.account.findUnique({ where: { code } });
  if (!acc?.isCash) throw new Error("اختر حساب صندوق أو بنك صحيحا");
  return code;
}

export async function postIpcApproval(tx: Tx, ipcId: string, userId: string | null) {
  const ipc = await tx.paymentCertificate.findUniqueOrThrow({ where: { id: ipcId }, include: { project: true } });
  return postEntry(tx, {
    date: ipc.approvedAt ?? ipc.periodTo,
    description: `اعتماد مستخلص المالك رقم ${ipc.number} - ${ipc.project.code}`,
    sourceKey: `IPC_APPROVED:${ipc.id}`,
    projectId: ipc.projectId,
    createdById: userId,
    lines: ipcApprovalLines({ ...ipc, clientId: ipc.project.clientId }),
  });
}

export async function postIpcPayment(tx: Tx, ipcId: string, cashCode: string, userId: string | null) {
  const ipc = await tx.paymentCertificate.findUniqueOrThrow({ where: { id: ipcId }, include: { project: true } });
  const amount = ipc.approvedAmount ?? ipc.netPayable;
  return postEntry(tx, {
    date: ipc.paidAt ?? new Date(),
    description: `تحصيل مستخلص المالك رقم ${ipc.number} - ${ipc.project.code}`,
    sourceKey: `IPC_PAID:${ipc.id}`,
    projectId: ipc.projectId,
    createdById: userId,
    lines: [
      { account: cashCode, debit: amount },
      { account: ACC.AR, credit: amount, partyId: ipc.project.clientId },
    ],
  });
}

// الاستلام المخزني يثبت التكلفة على المشروع ورمز التكلفة، والمستحق للمورد
export async function postGoodsReceipt(tx: Tx, grnId: string, userId: string | null) {
  const grn = await tx.goodsReceipt.findUniqueOrThrow({
    where: { id: grnId },
    include: { lines: { include: { poLine: true } }, order: { include: { costCode: true } } },
  });
  const value = grn.lines.reduce((s, l) => s + l.quantity * l.poLine.unitPrice, 0);
  const po = grn.order;
  return postEntry(tx, {
    date: grn.date,
    description: `استلام مواد على أمر الشراء رقم ${po.number}${grn.deliveryNote ? ` (إشعار ${grn.deliveryNote})` : ""}`,
    sourceKey: `GRN:${grn.id}`,
    projectId: po.projectId,
    createdById: userId,
    lines: [
      { account: costAccountFor(po.costCode?.code), debit: value, costCodeId: po.costCodeId },
      { account: ACC.AP, credit: value, partyId: po.supplierId },
    ],
  });
}

export async function postSubCertApproval(tx: Tx, certId: string, userId: string | null) {
  const cert = await tx.subcontractCertificate.findUniqueOrThrow({
    where: { id: certId },
    include: { subcontract: true, lines: { include: { line: { include: { boqItem: true } } } } },
  });
  return postEntry(tx, {
    date: cert.approvedAt ?? cert.periodTo,
    description: `اعتماد مستخلص الباطن رقم ${cert.number} لعقد ${cert.subcontract.number}`,
    sourceKey: `SUB_APPROVED:${cert.id}`,
    projectId: cert.subcontract.projectId,
    createdById: userId,
    lines: subCertApprovalLines({
      lines: cert.lines.map((l) => ({ amount: l.currentQty * l.rate, costCodeId: l.line.boqItem.costCodeId })),
      retention: cert.retention,
      vat: cert.vat,
      netPayable: cert.netPayable,
      partyId: cert.subcontract.subcontractorId,
    }),
  });
}

export async function postSubCertPayment(tx: Tx, certId: string, cashCode: string, userId: string | null) {
  const cert = await tx.subcontractCertificate.findUniqueOrThrow({ where: { id: certId }, include: { subcontract: true } });
  return postEntry(tx, {
    date: cert.paidAt ?? new Date(),
    description: `دفع مستخلص الباطن رقم ${cert.number} لعقد ${cert.subcontract.number}`,
    sourceKey: `SUB_PAID:${cert.id}`,
    projectId: cert.subcontract.projectId,
    createdById: userId,
    lines: [
      { account: ACC.AP_SUB, debit: cert.netPayable, partyId: cert.subcontract.subcontractorId },
      { account: cashCode, credit: cert.netPayable },
    ],
  });
}

export async function postExpense(tx: Tx, expenseId: string, userId: string | null) {
  const e = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { costCode: true, paidFrom: true } });
  return postEntry(tx, {
    date: e.date,
    description: `مصروف موقع رقم ${e.number}: ${e.description}`,
    sourceKey: `EXPENSE:${e.id}`,
    projectId: e.projectId,
    createdById: userId,
    lines: [
      { account: costAccountFor(e.costCode.code), debit: e.amount, costCodeId: e.costCodeId },
      { account: ACC.VAT_IN, debit: e.vat },
      { account: e.paidFrom.code, credit: e.amount + e.vat },
    ],
  });
}

export async function postPayment(tx: Tx, paymentId: string, userId: string | null) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { account: true } });
  const lines: Line[] =
    p.kind === "SUPPLIER_PAYMENT"
      ? [
          { account: ACC.AP, debit: p.amount, partyId: p.partyId },
          { account: p.account.code, credit: p.amount },
        ]
      : [
          { account: p.account.code, debit: p.amount },
          { account: ACC.ADV_CLIENT, credit: p.amount, partyId: p.partyId },
        ];
  return postEntry(tx, {
    date: p.date,
    description: p.kind === "SUPPLIER_PAYMENT" ? `سند صرف رقم ${p.number} لمورد` : `سند قبض رقم ${p.number}: دفعة مقدمة من العميل`,
    sourceKey: `PAYMENT:${p.id}`,
    projectId: p.projectId,
    createdById: userId,
    lines,
  });
}

// ترحيل أي حدث معتمد لم يُرحَّل بعد (للبيانات السابقة لتفعيل المحاسبة). آمن للتكرار
export async function syncPostings() {
  const before = await db.journalEntry.count();
  const [ipcs, grns, certs, expenses, payments] = await Promise.all([
    db.paymentCertificate.findMany({ where: { status: { in: ["APPROVED", "PAID"] } }, orderBy: { number: "asc" } }),
    db.goodsReceipt.findMany({ orderBy: { date: "asc" } }),
    db.subcontractCertificate.findMany({ where: { status: { in: ["APPROVED", "PAID"] } }, orderBy: { number: "asc" } }),
    db.expense.findMany(),
    db.payment.findMany(),
  ]);
  for (const ipc of ipcs) {
    await db.$transaction(async (tx) => {
      await postIpcApproval(tx, ipc.id, null);
      if (ipc.status === "PAID") await postIpcPayment(tx, ipc.id, ACC.BANK, null);
    });
  }
  for (const g of grns) await db.$transaction((tx) => postGoodsReceipt(tx, g.id, null));
  for (const c of certs) {
    await db.$transaction(async (tx) => {
      await postSubCertApproval(tx, c.id, null);
      if (c.status === "PAID") await postSubCertPayment(tx, c.id, ACC.BANK, null);
    });
  }
  for (const e of expenses) await db.$transaction((tx) => postExpense(tx, e.id, null));
  for (const p of payments) await db.$transaction((tx) => postPayment(tx, p.id, null));
  return (await db.journalEntry.count()) - before;
}

// أرصدة كل الحسابات (ميزان المراجعة)، لكل الشركة أو لمشروع
export async function trialBalance(projectId?: string, upTo?: Date) {
  const [accounts, sums] = await Promise.all([
    db.account.findMany({ orderBy: { code: "asc" } }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { ...(projectId ? { projectId } : {}), ...(upTo ? { entry: { date: { lte: upTo } } } : {}) },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const map = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => {
    const debit = r2(map.get(a.id)?.debit ?? 0);
    const credit = r2(map.get(a.id)?.credit ?? 0);
    return { ...a, debit, credit, balance: normalBalance(a.type, debit, credit) };
  });
}

// رصيد كل طرف (مورد، مقاول باطن، عميل) على حساب معين
export async function partyBalances(accountCode: string, projectId?: string) {
  const acc = await db.account.findUniqueOrThrow({ where: { code: accountCode } });
  const rows = await db.journalLine.groupBy({
    by: ["partyId"],
    where: { accountId: acc.id, partyId: { not: null }, ...(projectId ? { projectId } : {}) },
    _sum: { debit: true, credit: true },
  });
  const parties = await db.party.findMany({ where: { id: { in: rows.map((r) => r.partyId!) } } });
  const names = new Map(parties.map((p) => [p.id, p]));
  return rows
    .map((r) => ({ party: names.get(r.partyId!)!, balance: normalBalance(acc.type, r._sum.debit ?? 0, r._sum.credit ?? 0) }))
    .filter((r) => Math.abs(r.balance) > 0.005)
    .sort((a, b) => b.balance - a.balance);
}

export async function accountBalance(code: string, projectId?: string) {
  const acc = await db.account.findUniqueOrThrow({ where: { code } });
  const s = await db.journalLine.aggregate({ where: { accountId: acc.id, ...(projectId ? { projectId } : {}) }, _sum: { debit: true, credit: true } });
  return normalBalance(acc.type, s._sum.debit ?? 0, s._sum.credit ?? 0);
}

// رصيد المورد على مشروع (للتحقق قبل الصرف)
export async function partyBalance(accountCode: string, partyId: string, projectId: string) {
  const acc = await db.account.findUniqueOrThrow({ where: { code: accountCode } });
  const s = await db.journalLine.aggregate({ where: { accountId: acc.id, partyId, projectId }, _sum: { debit: true, credit: true } });
  return normalBalance(acc.type, s._sum.debit ?? 0, s._sum.credit ?? 0);
}
