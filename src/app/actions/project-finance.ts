"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay, todayStr } from "@/lib/format";
import { cashAccountCode, postExpense } from "@/lib/accounting";
import { r2 } from "@/lib/ledger";

const base = (projectId: string) => `/projects/${projectId}/finance`;

export async function createExpense(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "expense.create");
      const description = str(form, "description");
      const costCodeId = str(form, "costCodeId");
      const amount = r2(num(form, "amount"));
      const vat = r2(num(form, "vat"));
      if (!description || !costCodeId) throw new Error("الوصف ورمز التكلفة مطلوبان");
      if (amount <= 0 || vat < 0) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
      const e = await db.$transaction(async (tx) => {
        const code = await cashAccountCode(tx, str(form, "cashAccount"));
        const account = await tx.account.findUniqueOrThrow({ where: { code } });
        const max = await tx.expense.aggregate({ where: { projectId }, _max: { number: true } });
        const created = await tx.expense.create({
          data: {
            projectId,
            number: (max._max.number ?? 0) + 1,
            date: parseDay(str(form, "date") || todayStr()),
            costCodeId,
            description,
            payee: str(form, "payee") || null,
            amount,
            vat,
            paidFromId: account.id,
            reference: str(form, "reference") || null,
            createdById: user.id,
          },
        });
        await postExpense(tx, created.id, user.id);
        return created;
      });
      await audit(user.id, "create", "Expense", e.id, { amount });
    },
    "تم تسجيل المصروف وتحميله على رمز التكلفة",
  );
}

export async function saveBudgets(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "budget.edit");
      const codes = await db.costCode.findMany();
      let changed = 0;
      for (const c of codes) {
        const raw = str(form, `budget_${c.id}`);
        if (raw === "") continue;
        const amount = r2(num(form, `budget_${c.id}`));
        if (amount < 0) throw new Error("الموازنة لا تكون سالبة");
        await db.costBudget.upsert({
          where: { projectId_costCodeId: { projectId, costCodeId: c.id } },
          update: { amount },
          create: { projectId, costCodeId: c.id, amount },
        });
        changed++;
      }
      await audit(user.id, "update", "CostBudget", projectId, { lines: changed });
    },
    "تم حفظ الموازنة",
  );
}

export async function createGuarantee(projectId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "guarantee.manage");
      const bank = str(form, "bank");
      const number = str(form, "number");
      const amount = r2(num(form, "amount"));
      const issue = str(form, "issueDate");
      const expiry = str(form, "expiryDate");
      if (!bank || !number || amount <= 0 || !issue || !expiry) throw new Error("أكمل بيانات الضمان: البنك، الرقم، المبلغ، التواريخ");
      if (expiry <= issue) throw new Error("تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار");
      const g = await db.bankGuarantee.create({
        data: { projectId, type: str(form, "type") || "PERFORMANCE", bank, number, amount, issueDate: parseDay(issue), expiryDate: parseDay(expiry), notes: str(form, "notes") || null },
      });
      await audit(user.id, "create", "BankGuarantee", g.id);
    },
    "تم تسجيل خطاب الضمان",
  );
}

export async function extendGuarantee(projectId: string, guaranteeId: string, form: FormData) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "guarantee.manage");
      const g = await db.bankGuarantee.findFirst({ where: { id: guaranteeId, projectId, status: "ACTIVE" } });
      if (!g) throw new Error("الضمان غير موجود أو مُفرج عنه");
      const expiry = str(form, "expiryDate");
      if (!expiry || parseDay(expiry) <= g.expiryDate) throw new Error("التاريخ الجديد يجب أن يكون بعد تاريخ الانتهاء الحالي");
      await db.bankGuarantee.update({ where: { id: g.id }, data: { expiryDate: parseDay(expiry) } });
      await audit(user.id, "extend", "BankGuarantee", g.id, { expiry });
    },
    "تم تمديد الضمان",
  );
}

export async function releaseGuarantee(projectId: string, guaranteeId: string) {
  await runAction(
    base(projectId),
    async () => {
      const { user } = await requireProjectAccess(projectId, "guarantee.manage");
      const g = await db.bankGuarantee.findFirst({ where: { id: guaranteeId, projectId, status: "ACTIVE" } });
      if (!g) throw new Error("الضمان غير موجود أو مُفرج عنه");
      await db.bankGuarantee.update({ where: { id: g.id }, data: { status: "RELEASED", releasedAt: new Date() } });
      await audit(user.id, "release", "BankGuarantee", g.id);
    },
    "تم تسجيل الإفراج عن الضمان",
  );
}
