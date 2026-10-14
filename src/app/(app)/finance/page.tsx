import Link from "next/link";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { trialBalance } from "@/lib/accounting";
import { ACC, ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/ledger";
import { fmtMoney } from "@/lib/format";
import { runSync } from "@/app/actions/finance";
import { Flash, Stat } from "@/components/ui";

type Search = Promise<{ error?: string; notice?: string; project?: string }>;

export default async function TrialBalancePage({ searchParams }: { searchParams: Search }) {
  const user = await requirePagePermission("finance.view");
  const { error, notice, project } = await searchParams;
  const [rows, projects] = await Promise.all([trialBalance(project || undefined), db.project.findMany({ orderBy: { code: "asc" } })]);
  const bal = (code: string) => rows.find((r) => r.code === code)?.balance ?? 0;
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const revenue = rows.filter((r) => r.type === "REVENUE").reduce((s, r) => s + r.balance, 0);
  const cost = rows.filter((r) => r.type === "EXPENSE").reduce((s, r) => s + r.balance, 0);
  const groups = (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => ({ t, rows: rows.filter((r) => r.type === t) }));
  const q = project ? `?project=${project}` : "";

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="النقدية والبنك" value={<span className="num">{fmtMoney(bal(ACC.CASH) + bal(ACC.BANK))}</span>} />
        <Stat label="مستحق من العملاء" value={<span className="num">{fmtMoney(bal(ACC.AR))}</span>} hint={`محتجزات لدى العملاء ${fmtMoney(bal(ACC.RET_REC))}`} />
        <Stat label="مستحق للموردين" value={<span className="num">{fmtMoney(bal(ACC.AP))}</span>} />
        <Stat label="مستحق لمقاولي الباطن" value={<span className="num">{fmtMoney(bal(ACC.AP_SUB))}</span>} hint={`محتجزات عليهم ${fmtMoney(bal(ACC.RET_PAY))}`} />
        <Stat label="ضريبة مستحقة للهيئة" value={<span className="num">{fmtMoney(bal(ACC.VAT_OUT) - bal(ACC.VAT_IN))}</span>} hint="المخرجات ناقص المدخلات" />
        <Stat label="مجمل الربح" value={<span className="num">{fmtMoney(revenue - cost)}</span>} hint={`إيراد ${fmtMoney(revenue)}`} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex items-end gap-2">
          <div>
            <label>المشروع</label>
            <select name="project" defaultValue={project ?? ""} className="w-auto">
              <option value="">كل الشركة</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-secondary">عرض</button>
        </form>
        {can(user.role, "finance.post") && (
          <form action={runSync}>
            <button className="btn-secondary" title="يرحّل أي مستخلص أو استلام معتمد قبل تفعيل المحاسبة">
              ترحيل الأحداث غير المرحّلة
            </button>
          </form>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الحساب</th>
              <th>الاسم</th>
              <th>مدين</th>
              <th>دائن</th>
              <th>الرصيد</th>
            </tr>
          </thead>
          {groups.map(({ t, rows }) => (
            <tbody key={t}>
              <tr>
                <td colSpan={5} className="bg-slate-50 font-semibold text-slate-600">
                  {ACCOUNT_TYPE_LABELS[t]}
                </td>
              </tr>
              {rows.map((r) => (
                <tr key={r.id} className={r.debit || r.credit ? "" : "text-slate-400"}>
                  <td className="num">
                    <Link href={`/finance/accounts/${r.code}${q}`} className="text-brand-700 hover:underline">
                      {r.code}
                    </Link>
                  </td>
                  <td>{r.name}</td>
                  <td className="num">{fmtMoney(r.debit)}</td>
                  <td className="num">{fmtMoney(r.credit)}</td>
                  <td className="num font-semibold">{fmtMoney(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="font-bold">
              <td colSpan={2}>الإجمالي {Math.abs(totalDebit - totalCredit) < 0.01 ? "(متوازن)" : "(غير متوازن!)"}</td>
              <td className="num">{fmtMoney(totalDebit)}</td>
              <td className="num">{fmtMoney(totalCredit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
