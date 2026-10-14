import "server-only";
import { db } from "./db";
import { r2 } from "./ledger";

// الموازنة مقابل الملتزم به والفعلي لكل رمز تكلفة
// الملتزم: أوامر الشراء غير الملغاة + قيمة عقود الباطن + المصروفات المباشرة
// الفعلي: ما رُحِّل على حسابات التكاليف (استلام مواد، مستخلصات باطن معتمدة، مصروفات)
export async function costControl(projectId: string) {
  const [codes, budgets, actualRows, pos, subLines, expenses] = await Promise.all([
    db.costCode.findMany({ orderBy: { code: "asc" } }),
    db.costBudget.findMany({ where: { projectId } }),
    db.journalLine.groupBy({
      by: ["costCodeId"],
      where: { projectId, account: { type: "EXPENSE" } },
      _sum: { debit: true, credit: true },
    }),
    db.purchaseOrder.groupBy({ by: ["costCodeId"], where: { projectId, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    db.subcontractLine.findMany({ where: { subcontract: { projectId } }, include: { boqItem: true } }),
    db.expense.groupBy({ by: ["costCodeId"], where: { projectId }, _sum: { amount: true } }),
  ]);
  const budget = new Map(budgets.map((b) => [b.costCodeId as string | null, b.amount]));
  const actual = new Map(actualRows.map((r) => [r.costCodeId, (r._sum.debit ?? 0) - (r._sum.credit ?? 0)]));
  const committed = new Map<string | null, number>();
  const add = (k: string | null, v: number) => committed.set(k, (committed.get(k) ?? 0) + v);
  for (const p of pos) add(p.costCodeId, p._sum.total ?? 0);
  for (const l of subLines) add(l.boqItem.costCodeId, l.quantity * l.rate);
  for (const e of expenses) add(e.costCodeId, e._sum.amount ?? 0);

  const keys: (string | null)[] = [...codes.map((c) => c.id), null];
  const rows = keys
    .map((id) => {
      const code = codes.find((c) => c.id === id) ?? null;
      const b = budget.get(id) ?? 0;
      const a = r2(actual.get(id) ?? 0);
      const c = r2(committed.get(id) ?? 0);
      // التكلفة المتوقعة عند الانتهاء: الأكبر من الملتزم والفعلي، ولا تقل عن الموازنة ما لم يكتمل البند
      const forecast = Math.max(c, a);
      return { id, code, budget: b, committed: c, actual: a, forecast, variance: r2(b - forecast) };
    })
    .filter((r) => r.budget || r.committed || r.actual);
  const totals = rows.reduce(
    (t, r) => ({ budget: t.budget + r.budget, committed: t.committed + r.committed, actual: t.actual + r.actual, forecast: t.forecast + r.forecast }),
    { budget: 0, committed: 0, actual: 0, forecast: 0 },
  );
  return { rows, totals, overBudget: rows.filter((r) => r.budget > 0 && r.forecast > r.budget + 0.005) };
}

// قائمة الدخل للمشروع من القيود
export async function projectPnl(projectId: string) {
  const rows = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { projectId, account: { type: { in: ["REVENUE", "EXPENSE"] } } },
    _sum: { debit: true, credit: true },
  });
  const accounts = await db.account.findMany({ where: { id: { in: rows.map((r) => r.accountId) } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let revenue = 0;
  const costs: { name: string; code: string; amount: number }[] = [];
  for (const r of rows) {
    const a = byId.get(r.accountId)!;
    const d = r._sum.debit ?? 0;
    const c = r._sum.credit ?? 0;
    if (a.type === "REVENUE") revenue += c - d;
    else costs.push({ name: a.name, code: a.code, amount: r2(d - c) });
  }
  costs.sort((a, b) => a.code.localeCompare(b.code));
  const cost = costs.reduce((s, c) => s + c.amount, 0);
  return { revenue: r2(revenue), costs, cost: r2(cost), margin: r2(revenue - cost), marginPct: revenue > 0 ? (revenue - cost) / revenue : null };
}
