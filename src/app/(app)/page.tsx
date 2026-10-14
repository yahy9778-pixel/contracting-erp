import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, projectScope } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { projectSummary } from "@/lib/metrics";
import { projectAlerts } from "@/lib/alerts";
import { projectSchedule } from "@/lib/schedule-service";
import { projectPnl } from "@/lib/cost-control";
import { safetyStats } from "@/lib/safety-service";
import { trialBalance } from "@/lib/accounting";
import { ACC } from "@/lib/ledger";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";

// لوحة الإدارة: كل المشاريع في سطر واحد لكل مشروع، ومؤشرات الشركة لمن يملك الصلاحية المالية
export default async function Dashboard() {
  const user = await requireUser();
  const showMoney = can(user.role, "money.view");
  const showCompany = can(user.role, "finance.view");
  const projects = await db.project.findMany({
    where: projectScope(user),
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });
  const rows = await Promise.all(
    projects.map(async (p) => {
      const [s, a, sched, pnl, hse] = await Promise.all([
        projectSummary(p.id),
        projectAlerts(p.id, { role: user.role }),
        projectSchedule(p.id, undefined, { curve: false }),
        showMoney ? projectPnl(p.id) : null,
        safetyStats(p.id),
      ]);
      return { p, s, a, spi: sched.summary.spi, hasSchedule: sched.rows.length > 0, pnl, hse };
    }),
  );

  let company: { cash: number; ar: number; ap: number; revenue: number; cost: number; inventory: number; guarantees: number; staff: number } | null = null;
  if (showCompany) {
    const [tb, g, staff] = await Promise.all([
      trialBalance(),
      db.bankGuarantee.aggregate({ where: { status: "ACTIVE" }, _sum: { amount: true } }),
      db.employee.count({ where: { active: true } }),
    ]);
    const bal = (c: string) => tb.find((r) => r.code === c)?.balance ?? 0;
    company = {
      cash: bal(ACC.CASH) + bal(ACC.BANK),
      ar: bal(ACC.AR) + bal(ACC.RET_REC),
      ap: bal(ACC.AP) + bal(ACC.AP_SUB) + bal(ACC.SALARIES_PAYABLE),
      revenue: tb.filter((r) => r.type === "REVENUE").reduce((t, r) => t + r.balance, 0),
      cost: tb.filter((r) => r.type === "EXPENSE").reduce((t, r) => t + r.balance, 0),
      inventory: bal(ACC.INVENTORY),
      guarantees: g._sum.amount ?? 0,
      staff,
    };
  }
  const totalContract = rows.reduce((t, r) => t + r.p.contractValue, 0);
  const totalExecuted = rows.reduce((t, r) => t + r.s.executedValue, 0);
  const highAlerts = rows.reduce((t, r) => t + r.a.filter((x) => x.level === "high").length, 0);

  return (
    <>
      <PageHeader
        title="المشاريع"
        sub="ملخص لحظي لكل مشروع من التقارير والمستخلصات والقيود والجدول الزمني والسلامة"
        actions={
          can(user.role, "projects.manage") && (
            <Link href="/projects/new" className="btn">
              مشروع جديد
            </Link>
          )
        }
      />

      {company && (
        <div className="mb-6 grid gap-4 md:grid-cols-4 lg:grid-cols-8">
          <Stat label="قيمة العقود" value={<span className="num text-lg">{fmtMoney(totalContract)}</span>} hint={`المنفذ ${fmtPct(totalContract ? totalExecuted / totalContract : 0)}`} />
          <Stat label="الإيراد المعتمد" value={<span className="num text-lg">{fmtMoney(company.revenue)}</span>} />
          <Stat label="صافي الربح المحاسبي" value={<span className={`num text-lg ${company.revenue - company.cost < 0 ? "text-red-700" : ""}`}>{fmtMoney(company.revenue - company.cost)}</span>} />
          <Stat label="النقدية والبنوك" value={<span className="num text-lg">{fmtMoney(company.cash)}</span>} />
          <Stat label="لنا (ذمم ومحتجزات)" value={<span className="num text-lg">{fmtMoney(company.ar)}</span>} />
          <Stat label="علينا" value={<span className="num text-lg">{fmtMoney(company.ap)}</span>} hint="موردون وباطن ورواتب" />
          <Stat label="المخزون" value={<span className="num text-lg">{fmtMoney(company.inventory)}</span>} />
          <Stat label="ضمانات قائمة" value={<span className="num text-lg">{fmtMoney(company.guarantees)}</span>} hint={`${company.staff} موظف وعامل`} />
        </div>
      )}
      {highAlerts > 0 && (
        <p className="mb-4 text-sm font-semibold text-red-700">{highAlerts} تنبيه عاجل في المشاريع: افتح المشروع لترى التفاصيل.</p>
      )}

      {rows.length === 0 ? (
        <Empty>لا توجد مشاريع مسندة إليك بعد.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>المشروع</th>
                <th>الحالة</th>
                {showMoney && <th>قيمة العقد</th>}
                <th>نسبة الإنجاز</th>
                <th>SPI</th>
                {showMoney && <th>هامش الربح</th>}
                <th>بدون إصابة</th>
                <th>تنبيهات</th>
                {showMoney && <th>آخر مستخلص</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, s, a, spi, hasSchedule, pnl, hse }) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${p.id}`} className="font-semibold text-brand-700 hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {p.code} · {p.client.name}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  {showMoney && <td className="num">{fmtMoney(p.contractValue)}</td>}
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, s.progress * 100)}%` }} />
                      </div>
                      <span className="num text-xs">{fmtPct(s.progress)}</span>
                    </div>
                  </td>
                  <td className={`num font-semibold ${spi !== null && spi < 0.9 ? "text-red-700" : spi !== null && spi >= 1 ? "text-emerald-700" : ""}`}>
                    {hasSchedule && spi !== null ? spi.toFixed(2) : "—"}
                  </td>
                  {showMoney && (
                    <td className={`num ${pnl && pnl.margin < 0 ? "text-red-700" : ""}`}>
                      {pnl && pnl.revenue > 0 ? fmtPct(pnl.marginPct ?? 0) : "—"}
                    </td>
                  )}
                  <td className="num">{hse.daysWithoutLti} يوم</td>
                  <td>
                    {a.length === 0 ? (
                      <span className="text-emerald-700">لا يوجد</span>
                    ) : (
                      <Link href={`/projects/${p.id}`} className={`font-semibold hover:underline ${a.some((x) => x.level === "high") ? "text-red-700" : "text-amber-700"}`}>
                        {a.length} تنبيه
                      </Link>
                    )}
                  </td>
                  {showMoney && (
                    <td>
                      {s.lastIpc ? (
                        <span className="flex items-center gap-2">
                          <span>رقم {s.lastIpc.number}</span>
                          <StatusBadge status={s.lastIpc.status} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
