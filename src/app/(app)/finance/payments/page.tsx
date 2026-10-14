import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ACC, normalBalance } from "@/lib/ledger";
import { fmtDate, fmtMoney, todayStr } from "@/lib/format";
import { createPayment } from "@/app/actions/finance";
import { CashAccountSelect } from "@/components/cash-select";
import { Flash } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

// أرصدة الأطراف لكل مشروع على حساب معين
async function balancesByProject(accountCode: string) {
  const acc = await db.account.findUniqueOrThrow({ where: { code: accountCode } });
  const rows = await db.journalLine.groupBy({
    by: ["partyId", "projectId"],
    where: { accountId: acc.id, partyId: { not: null } },
    _sum: { debit: true, credit: true },
  });
  const [parties, projects] = await Promise.all([
    db.party.findMany({ where: { id: { in: rows.map((r) => r.partyId!) } } }),
    db.project.findMany({ where: { id: { in: rows.map((r) => r.projectId!).filter(Boolean) } } }),
  ]);
  return rows
    .map((r) => ({
      party: parties.find((p) => p.id === r.partyId)!,
      project: projects.find((p) => p.id === r.projectId),
      balance: normalBalance(acc.type, r._sum.debit ?? 0, r._sum.credit ?? 0),
    }))
    .filter((r) => r.project && Math.abs(r.balance) > 0.005)
    .sort((a, b) => b.balance - a.balance);
}

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("finance.view");
  const { error, notice } = await searchParams;
  const [suppliers, subs, clients, payments, projects, advances] = await Promise.all([
    balancesByProject(ACC.AP),
    balancesByProject(ACC.AP_SUB),
    balancesByProject(ACC.AR),
    db.payment.findMany({ include: { party: true, project: true, account: true }, orderBy: { number: "desc" }, take: 50 }),
    db.project.findMany({ where: { advanceAmount: { gt: 0 } }, orderBy: { code: "asc" } }),
    db.payment.groupBy({ by: ["projectId"], where: { kind: "ADVANCE_RECEIPT" }, _sum: { amount: true } }),
  ]);
  const advanceLeft = projects
    .map((p) => ({ p, left: p.advanceAmount - (advances.find((a) => a.projectId === p.id)?._sum.amount ?? 0) }))
    .filter((x) => x.left > 0.005);
  const canPost = can(user.role, "finance.post");

  const BalanceTable = ({ title, rows, empty }: { title: string; rows: Awaited<ReturnType<typeof balancesByProject>>; empty: string }) => (
    <div className="card overflow-x-auto p-0">
      <h2 className="px-4 pt-4">{title}</h2>
      <table className="mt-2">
        <thead>
          <tr>
            <th>الطرف</th>
            <th>المشروع</th>
            <th>الرصيد</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="text-center text-slate-500">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.party.id}-${r.project!.id}`}>
              <td>{r.party.name}</td>
              <td>{r.project!.code}</td>
              <td className="num font-semibold">{fmtMoney(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />

      {canPost && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={createPayment} className="card space-y-3">
            <h2>سند صرف لمورد</h2>
            <input type="hidden" name="kind" value="SUPPLIER_PAYMENT" />
            <div>
              <label>المورد والمشروع (بالمستحق الحالي)</label>
              <select name="target" required defaultValue="">
                <option value="" disabled>
                  اختر
                </option>
                {suppliers
                  .filter((s) => s.balance > 0)
                  .map((s) => (
                    <option key={`${s.party.id}-${s.project!.id}`} value={`${s.project!.id}:${s.party.id}`}>
                      {s.party.name} · {s.project!.code} · مستحق {fmtMoney(s.balance)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>المبلغ</label>
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </div>
              <div>
                <label>التاريخ</label>
                <input name="date" type="date" defaultValue={todayStr()} required />
              </div>
              <div>
                <label>من حساب</label>
                <CashAccountSelect className="w-full" />
              </div>
              <div>
                <label>رقم الشيك / التحويل</label>
                <input name="reference" />
              </div>
            </div>
            <button className="btn">ترحيل سند الصرف</button>
          </form>

          <form action={createPayment} className="card space-y-3">
            <h2>سند قبض: الدفعة المقدمة من العميل</h2>
            <input type="hidden" name="kind" value="ADVANCE_RECEIPT" />
            <div>
              <label>المشروع (بالمتبقي من الدفعة المقدمة)</label>
              <select name="target" required defaultValue="">
                <option value="" disabled>
                  اختر
                </option>
                {advanceLeft.map(({ p, left }) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · متبقي {fmtMoney(left)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>المبلغ</label>
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </div>
              <div>
                <label>التاريخ</label>
                <input name="date" type="date" defaultValue={todayStr()} required />
              </div>
              <div>
                <label>يُودع في</label>
                <CashAccountSelect className="w-full" />
              </div>
              <div>
                <label>المرجع</label>
                <input name="reference" />
              </div>
            </div>
            <p className="text-xs text-slate-500">تحصيل المستخلصات يُسجل من صفحة المستخلص، ودفع مقاولي الباطن من صفحة عقد الباطن.</p>
            <button className="btn">ترحيل سند القبض</button>
          </form>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <BalanceTable title="مستحق للموردين" rows={suppliers} empty="لا توجد أرصدة للموردين." />
        <BalanceTable title="مستحق لمقاولي الباطن" rows={subs} empty="لا توجد أرصدة لمقاولي الباطن." />
        <BalanceTable title="مستحق من العملاء" rows={clients} empty="لا توجد ذمم على العملاء." />
      </div>

      <div className="card overflow-x-auto p-0">
        <h2 className="px-4 pt-4">آخر السندات</h2>
        <table className="mt-2">
          <thead>
            <tr>
              <th>الرقم</th>
              <th>التاريخ</th>
              <th>النوع</th>
              <th>الطرف</th>
              <th>المشروع</th>
              <th>الحساب</th>
              <th>المبلغ</th>
              <th>المرجع</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد سندات بعد.
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="num">{p.number}</td>
                <td className="num">{fmtDate(p.date)}</td>
                <td>{p.kind === "SUPPLIER_PAYMENT" ? "صرف لمورد" : "قبض دفعة مقدمة"}</td>
                <td>{p.party.name}</td>
                <td>{p.project.code}</td>
                <td>{p.account.name}</td>
                <td className="num font-semibold">{fmtMoney(p.amount)}</td>
                <td>{p.reference ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
