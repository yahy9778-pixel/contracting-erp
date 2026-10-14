import Link from "next/link";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtMoney, todayStr } from "@/lib/format";
import { generatePayroll } from "@/app/actions/hr";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function PayrollRunsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("hr.view");
  const { error, notice } = await searchParams;
  const runs = await db.payrollRun.findMany({ include: { lines: true }, orderBy: { month: "desc" } });
  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      {can(user.role, "hr.manage") && (
        <form action={generatePayroll} className="card flex flex-wrap items-end gap-3">
          <div>
            <label>الشهر</label>
            <input name="month" type="month" defaultValue={todayStr().slice(0, 7)} required />
          </div>
          <button className="btn">إعداد مسير الشهر</button>
          <p className="text-xs text-slate-500">دورة المسير: الموارد البشرية تعده، المالك يعتمده فتُحمَّل الرواتب على المشاريع، المالية تصرفه.</p>
        </form>
      )}
      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الشهر</th>
              <th>عدد الموظفين</th>
              <th>الإجمالي الصافي</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-slate-500">
                  لا توجد مسيرات بعد.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/hr/payroll/${r.id}`} className="num font-semibold text-brand-700 hover:underline">
                    {r.month}
                  </Link>
                </td>
                <td className="num">{r.lines.length}</td>
                <td className="num">{fmtMoney(r.lines.reduce((s, l) => s + l.net, 0))}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
