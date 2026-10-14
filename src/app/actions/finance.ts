"use server";

import { db } from "@/lib/db";
import { requirePermission, requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay, todayStr } from "@/lib/format";
import { cashAccountCode, partyBalance, postEntry, postPayment, syncPostings } from "@/lib/accounting";
import { ACC, JOURNAL_LINES, r2, type Line } from "@/lib/ledger";

const JOURNAL = "/finance/journal";
const PAYMENTS = "/finance/payments";


// قيد يومية يدوي: تسويات، رأس مال، إفراج عن محتجزات، رواتب... يجب أن يتوازن
export async function createJournal(form: FormData) {
  await runAction(JOURNAL, async () => {
    const user = await requirePermission("finance.post");
    const description = str(form, "description");
    if (!description) throw new Error("اكتب بيان القيد");
    const lines: Line[] = [];
    for (let i = 0; i < JOURNAL_LINES; i++) {
      const account = str(form, `account_${i}`);
      const debit = num(form, `debit_${i}`);
      const credit = num(form, `credit_${i}`);
      if (!account || (!debit && !credit)) continue;
      if (debit < 0 || credit < 0) throw new Error("لا تُدخل مبالغ سالبة، استخدم الطرف الآخر");
      if (debit && credit) throw new Error("السطر الواحد إما مدين أو دائن");
      lines.push({ account, debit, credit, projectId: str(form, `project_${i}`) || null, memo: str(form, `memo_${i}`) || undefined });
    }
    const entry = await db.$transaction((tx) =>
      postEntry(tx, { date: parseDay(str(form, "date") || todayStr()), description, kind: "MANUAL", createdById: user.id, lines }),
    );
    await audit(user.id, "create", "JournalEntry", entry.id, { number: entry.number });
    return `${JOURNAL}?notice=${encodeURIComponent(`تم ترحيل القيد رقم ${entry.number}`)}`;
  });
}

// القيود لا تُحذف: يُعكس القيد اليدوي بقيد مقابل
export async function reverseJournal(entryId: string) {
  await runAction(JOURNAL, async () => {
    const user = await requirePermission("finance.post");
    const entry = await db.journalEntry.findUnique({ where: { id: entryId }, include: { lines: { include: { account: true } } } });
    if (!entry || entry.kind !== "MANUAL" || entry.reversedBy) throw new Error("يمكن عكس القيود اليدوية غير المعكوسة فقط");
    const rev = await db.$transaction(async (tx) => {
      const created = await postEntry(tx, {
        date: parseDay(todayStr()),
        description: `عكس القيد رقم ${entry.number}: ${entry.description}`,
        sourceKey: `REVERSAL:${entry.id}`,
        kind: "MANUAL",
        createdById: user.id,
        lines: entry.lines.map((l) => ({
          account: l.account.code,
          debit: l.credit,
          credit: l.debit,
          projectId: l.projectId,
          costCodeId: l.costCodeId,
          partyId: l.partyId,
        })),
      });
      await tx.journalEntry.update({ where: { id: entry.id }, data: { reversedBy: created.id } });
      return created;
    });
    await audit(user.id, "reverse", "JournalEntry", entry.id, { reversal: rev.number });
    return `${JOURNAL}?notice=${encodeURIComponent(`تم عكس القيد بالقيد رقم ${rev.number}`)}`;
  });
}

// سند صرف لمورد، أو سند قبض للدفعة المقدمة من العميل
export async function createPayment(form: FormData) {
  await runAction(PAYMENTS, async () => {
    const kind = str(form, "kind");
    if (!["SUPPLIER_PAYMENT", "ADVANCE_RECEIPT"].includes(kind)) throw new Error("نوع السند غير صحيح");
    const target = str(form, "target");
    const [projectId, partyIdRaw] = target.split(":");
    if (!projectId) throw new Error("اختر المشروع");
    const { user, project } = await requireProjectAccess(projectId, "finance.post");
    const amount = r2(num(form, "amount"));
    if (amount <= 0) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
    let partyId = partyIdRaw;
    if (kind === "SUPPLIER_PAYMENT") {
      if (!partyId) throw new Error("اختر المورد");
      const due = await partyBalance(ACC.AP, partyId, projectId);
      if (amount > due + 0.005) throw new Error(`المبلغ أكبر من المستحق للمورد على هذا المشروع (${due.toFixed(2)})`);
    } else {
      partyId = project.clientId;
      const received = await db.payment.aggregate({ where: { projectId, kind: "ADVANCE_RECEIPT" }, _sum: { amount: true } });
      const remaining = r2(project.advanceAmount - (received._sum.amount ?? 0));
      if (amount > remaining + 0.005) throw new Error(`المتبقي من الدفعة المقدمة في العقد ${remaining.toFixed(2)} فقط`);
    }
    const payment = await db.$transaction(async (tx) => {
      const code = await cashAccountCode(tx, str(form, "cashAccount"));
      const account = await tx.account.findUniqueOrThrow({ where: { code } });
      const max = await tx.payment.aggregate({ _max: { number: true } });
      const p = await tx.payment.create({
        data: {
          number: (max._max.number ?? 0) + 1,
          date: parseDay(str(form, "date") || todayStr()),
          kind,
          projectId,
          partyId,
          accountId: account.id,
          amount,
          reference: str(form, "reference") || null,
          notes: str(form, "notes") || null,
          createdById: user.id,
        },
      });
      await postPayment(tx, p.id, user.id);
      return p;
    });
    await audit(user.id, "create", "Payment", payment.id, { kind, amount });
  }, "تم تسجيل السند وترحيل قيده");
}

export async function runSync() {
  await runAction("/finance", async () => {
    const user = await requirePermission("finance.post");
    const n = await syncPostings();
    await audit(user.id, "sync", "JournalEntry", "-", { posted: n });
    return `/finance?notice=${encodeURIComponent(n ? `تم ترحيل ${n} قيدا لأحداث سابقة` : "كل الأحداث مرحلة، لا يوجد جديد")}`;
  });
}
