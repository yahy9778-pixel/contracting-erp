import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountBalance } from "@/lib/accounting";
import { costControl, projectPnl } from "@/lib/cost-control";
import { plannedValueByMonth } from "@/lib/schedule-service";
import { cashflowForecast, monthStart } from "@/lib/schedule";
import { ACC } from "@/lib/ledger";
import { GUARANTEE_TYPES, daysBetween, fmtDate, fmtMoney, fmtPct, parseDay, todayStr } from "@/lib/format";
import { guaranteeState } from "@/lib/guarantees";
import { createExpense, createGuarantee, extendGuarantee, releaseGuarantee, saveBudgets } from "@/app/actions/project-finance";
import { CashAccountSelect } from "@/components/cash-select";
import { Flash, Stat, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const FORECAST_MONTHS = 6;
const LAG_MONTHS = 1;
const DEFAULT_COST_RATIO = 0.85;

export default async function ProjectFinancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user, project } = await requireProjectAccess(id, "money.view", { page: true });
  const today = parseDay(todayStr());
  const [cc, pnl, codes, expenses, guarantees, cash, bank, ar, ap, apSub, advanceIn] = await Promise.all([
    costControl(id),
    projectPnl(id),
    db.costCode.findMany({ orderBy: { code: "asc" } }),
    db.expense.findMany({ where: { projectId: id }, include: { costCode: true, paidFrom: true }, orderBy: { number: "desc" }, take: 30 }),
    db.bankGuarantee.findMany({ where: { projectId: id }, orderBy: [{ status: "asc" }, { expiryDate: "asc" }] }),
    accountBalance(ACC.CASH, id),
    accountBalance(ACC.BANK, id),
    accountBalance(ACC.AR, id),
    accountBalance(ACC.AP, id),
    accountBalance(ACC.AP_SUB, id),
    db.payment.aggregate({ where: { projectId: id, kind: "ADVANCE_RECEIPT" }, _sum: { amount: true } }),
  ]);

  // توقع التدفق النقدي من الجدول الزمني والموازنة
  const from = monthStart(today, -LAG_MONTHS);
  const planned = await plannedValueByMonth(id, from, FORECAST_MONTHS + LAG_MONTHS);
  const costRatio = cc.totals.budget > 0 && project.contractValue > 0 ? cc.totals.budget / project.contractValue : DEFAULT_COST_RATIO;
  const collectionFactor = Math.max(0, 1 - project.retentionPct / 100 - (project.contractValue > 0 ? project.advanceAmount / project.contractValue : 0));
  const forecast = cashflowForecast({
    plannedValue: planned,
    lagMonths: LAG_MONTHS,
    collectionFactor,
    costRatio,
    openReceivable: ar,
    openPayable: ap + apSub,
    openingCash: cash + bank,
  });
  const hasSchedule = planned.some((v) => v > 0);
  const maxFlow = Math.max(1, ...forecast.flatMap((r) => [r.inflow, r.outflow]));
  const canBudget = can(user.role, "budget.edit");
  const canGuarantee = can(user.role, "guarantee.manage");
  const budgetById = new Map(cc.rows.map((r) => [r.id, r]));

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />

      <div className="grid gap-4 md:grid-cols-5">
        <Stat label="الإيراد المعتمد" value={<span className="num">{fmtMoney(pnl.revenue)}</span>} hint="من المستخلصات المعتمدة" />
        <Stat label="التكلفة الفعلية" value={<span className="num">{fmtMoney(pnl.cost)}</span>} />
        <Stat
          label="مجمل الربح"
          value={<span className={`num ${pnl.margin < 0 ? "text-red-700" : ""}`}>{fmtMoney(pnl.margin)}</span>}
          hint={pnl.marginPct === null ? undefined : `هامش ${fmtPct(pnl.marginPct)}`}
        />
        <Stat label="رصيد المشروع النقدي" value={<span className="num">{fmtMoney(cash + bank)}</span>} hint={`دفعة مقدمة محصلة ${fmtMoney(advanceIn._sum.amount ?? 0)}`} />
        <Stat label="ذمم مفتوحة" value={<span className="num">{fmtMoney(ar)}</span>} hint={`علينا للموردين والباطن ${fmtMoney(ap + apSub)}`} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2>الموازنة مقابل الفعلي حسب رمز التكلفة</h2>
            <p className="text-sm text-slate-500">
              الملتزم به: أوامر الشراء وعقود الباطن والمصروفات. الفعلي: المرحّل محاسبيا. المتوقع عند الانتهاء: الأكبر منهما.
            </p>
          </div>
          {cc.overBudget.length > 0 && <span className="badge bg-red-100 text-red-800">{cc.overBudget.length} رمز تكلفة تجاوز الموازنة</span>}
        </div>
        <form action={saveBudgets.bind(null, id)} className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>رمز التكلفة</th>
                <th>الموازنة</th>
                <th>الملتزم به</th>
                <th>الفعلي</th>
                <th>المتوقع عند الانتهاء</th>
                <th>الفرق</th>
                <th>المصروف من الموازنة</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const r = budgetById.get(c.id);
                if (!r && !canBudget) return null;
                const over = r && r.budget > 0 && r.forecast > r.budget + 0.005;
                return (
                  <tr key={c.id} className={over ? "bg-red-50" : ""}>
                    <td>
                      <span className="num font-semibold">{c.code}</span> {c.name}
                    </td>
                    <td className="w-40">
                      {canBudget ? (
                        <input name={`budget_${c.id}`} type="number" min="0" step="0.01" defaultValue={r?.budget || ""} className="num" />
                      ) : (
                        <span className="num">{fmtMoney(r?.budget ?? 0)}</span>
                      )}
                    </td>
                    <td className="num">{fmtMoney(r?.committed ?? 0)}</td>
                    <td className="num">{fmtMoney(r?.actual ?? 0)}</td>
                    <td className="num">{fmtMoney(r?.forecast ?? 0)}</td>
                    <td className={`num font-semibold ${over ? "text-red-700" : ""}`}>{r ? fmtMoney(r.variance) : ""}</td>
                    <td>
                      {r && r.budget > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 rounded-full bg-slate-200">
                            <div className={`h-2 rounded-full ${over ? "bg-red-600" : "bg-brand-600"}`} style={{ width: `${Math.min(100, (r.actual / r.budget) * 100)}%` }} />
                          </div>
                          <span className="num text-xs">{fmtPct(r.actual / r.budget)}</span>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {budgetById.has(null) && (
                <tr>
                  <td className="text-slate-500">بدون رمز تكلفة</td>
                  <td />
                  <td className="num">{fmtMoney(budgetById.get(null)!.committed)}</td>
                  <td className="num">{fmtMoney(budgetById.get(null)!.actual)}</td>
                  <td className="num">{fmtMoney(budgetById.get(null)!.forecast)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td>الإجمالي</td>
                <td className="num">{fmtMoney(cc.totals.budget)}</td>
                <td className="num">{fmtMoney(cc.totals.committed)}</td>
                <td className="num">{fmtMoney(cc.totals.actual)}</td>
                <td className="num">{fmtMoney(cc.totals.forecast)}</td>
                <td className="num">{fmtMoney(cc.totals.budget - cc.totals.forecast)}</td>
                <td className="text-xs font-normal text-slate-500">
                  {project.contractValue > 0 && cc.totals.budget > 0 && `الموازنة ${fmtPct(cc.totals.budget / project.contractValue)} من قيمة العقد`}
                </td>
              </tr>
            </tfoot>
          </table>
          {canBudget && (
            <div className="border-t border-slate-200 p-4">
              <button className="btn">حفظ الموازنة</button>
            </div>
          )}
        </form>
      </section>

      <section className="space-y-3">
        <h2>توقع التدفق النقدي للأشهر القادمة</h2>
        <p className="text-sm text-slate-500">
          من الجدول الزمني: الصرف في شهر التنفيذ بنسبة تكلفة {fmtPct(costRatio)}
          {cc.totals.budget > 0 ? " (من الموازنة)" : " (افتراضية، أدخل الموازنة لتدقيقها)"}، والتحصيل بعد {LAG_MONTHS} شهر بنسبة {fmtPct(collectionFactor)} بعد المحتجز
          واسترداد الدفعة المقدمة. الشهر الأول يشمل الذمم المفتوحة الآن. المبالغ قبل الضريبة.
        </p>
        {!hasSchedule ? (
          <p className="card text-sm text-amber-700">لا يوجد جدول زمني للمشروع بعد. أنشئه من تبويب "التخطيط" ليظهر التوقع.</p>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>تحصيل متوقع</th>
                  <th>صرف متوقع</th>
                  <th>الصافي</th>
                  <th>الرصيد التراكمي</th>
                  <th className="w-1/4"></th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{monthStart(today, i).toISOString().slice(0, 7)}</td>
                    <td className="num text-emerald-700">{fmtMoney(r.inflow)}</td>
                    <td className="num text-red-700">{fmtMoney(r.outflow)}</td>
                    <td className="num">{fmtMoney(r.net)}</td>
                    <td className={`num font-semibold ${r.cumulative < 0 ? "text-red-700" : ""}`}>{fmtMoney(r.cumulative)}</td>
                    <td>
                      <div className="space-y-1">
                        <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${(r.inflow / maxFlow) * 100}%` }} />
                        <div className="h-1.5 rounded bg-red-400" style={{ width: `${(r.outflow / maxFlow) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {forecast.some((r) => r.cumulative < 0) && (
              <p className="border-t border-slate-200 p-4 text-sm font-semibold text-red-700">
                الرصيد النقدي للمشروع يصبح سالبا في الفترة القادمة: يحتاج تمويلا أو تسريع التحصيل.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2>مصروفات الموقع</h2>
        {can(user.role, "expense.create") && (
          <form action={createExpense.bind(null, id)} className="card grid gap-3 md:grid-cols-6">
            <div>
              <label>التاريخ</label>
              <input name="date" type="date" defaultValue={todayStr()} required />
            </div>
            <div className="md:col-span-2">
              <label>الوصف</label>
              <input name="description" required />
            </div>
            <div>
              <label>رمز التكلفة</label>
              <select name="costCodeId" required defaultValue="">
                <option value="" disabled>
                  اختر
                </option>
                {codes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>المبلغ قبل الضريبة</label>
              <input name="amount" type="number" min="0.01" step="0.01" required />
            </div>
            <div>
              <label>الضريبة</label>
              <input name="vat" type="number" min="0" step="0.01" defaultValue="0" />
            </div>
            <div>
              <label>المستفيد</label>
              <input name="payee" />
            </div>
            <div>
              <label>رقم الفاتورة</label>
              <input name="reference" />
            </div>
            <div>
              <label>دُفع من</label>
              <CashAccountSelect className="w-full" />
            </div>
            <div className="flex items-end md:col-span-3">
              <button className="btn">تسجيل المصروف</button>
            </div>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>الوصف</th>
                <th>رمز التكلفة</th>
                <th>المبلغ</th>
                <th>الضريبة</th>
                <th>من</th>
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500">
                    لا توجد مصروفات مسجلة.
                  </td>
                </tr>
              )}
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.number}</td>
                  <td className="num">{fmtDate(e.date)}</td>
                  <td>
                    {e.description}
                    {e.payee && <span className="text-xs text-slate-500"> · {e.payee}</span>}
                  </td>
                  <td className="num">{e.costCode.code}</td>
                  <td className="num">{fmtMoney(e.amount)}</td>
                  <td className="num">{fmtMoney(e.vat)}</td>
                  <td>{e.paidFrom.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2>خطابات الضمان</h2>
        {canGuarantee && (
          <form action={createGuarantee.bind(null, id)} className="card grid gap-3 md:grid-cols-6">
            <div>
              <label>النوع</label>
              <select name="type">
                {Object.entries(GUARANTEE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>البنك</label>
              <input name="bank" required />
            </div>
            <div>
              <label>رقم الخطاب</label>
              <input name="number" required />
            </div>
            <div>
              <label>المبلغ</label>
              <input name="amount" type="number" min="0.01" step="0.01" required />
            </div>
            <div>
              <label>تاريخ الإصدار</label>
              <input name="issueDate" type="date" required />
            </div>
            <div>
              <label>تاريخ الانتهاء</label>
              <input name="expiryDate" type="date" required />
            </div>
            <div className="md:col-span-6">
              <button className="btn">تسجيل الضمان</button>
            </div>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>النوع</th>
                <th>البنك والرقم</th>
                <th>المبلغ</th>
                <th>ينتهي في</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {guarantees.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    لا توجد خطابات ضمان.
                  </td>
                </tr>
              )}
              {guarantees.map((g) => (
                <tr key={g.id}>
                  <td>{GUARANTEE_TYPES[g.type] ?? g.type}</td>
                  <td>
                    {g.bank} · <span className="num">{g.number}</span>
                  </td>
                  <td className="num">{fmtMoney(g.amount)}</td>
                  <td className="num">
                    {fmtDate(g.expiryDate)}
                    {g.status === "ACTIVE" && <span className="text-xs text-slate-500"> ({daysBetween(today, g.expiryDate)} يوم)</span>}
                  </td>
                  <td>
                    <StatusBadge status={guaranteeState(g, today)} />
                  </td>
                  <td className="min-w-72">
                    {g.status === "ACTIVE" && canGuarantee && (
                      <div className="flex flex-wrap gap-2">
                        <form action={extendGuarantee.bind(null, id, g.id)} className="flex gap-2">
                          <input name="expiryDate" type="date" required className="w-auto" aria-label="تاريخ الانتهاء الجديد" />
                          <button className="btn-secondary">تمديد</button>
                        </form>
                        <form action={releaseGuarantee.bind(null, id, g.id)}>
                          <button className="text-xs text-red-600 hover:underline">إفراج</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
