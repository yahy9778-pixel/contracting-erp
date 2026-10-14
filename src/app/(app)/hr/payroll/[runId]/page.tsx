import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtMoney } from "@/lib/format";
import { approvePayroll, deletePayroll, payPayroll, updatePayrollLine } from "@/app/actions/hr";
import { CashAccountSelect } from "@/components/cash-select";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: SearchParams }) {
  const user = await requirePagePermission("hr.view");
  const { runId } = await params;
  const { error, notice } = await searchParams;
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { include: { employee: true, project: true }, orderBy: { employee: { code: "asc" } } } },
  });
  if (!run) notFound();
  const editable = run.status === "DRAFT" && can(user.role, "hr.manage");
  const total = (k: "basic" | "allowances" | "overtimePay" | "deductions" | "net") => run.lines.reduce((s, l) => s + l[k], 0);
  const byProject = new Map<string, number>();
  for (const l of run.lines) byProject.set(l.project?.code ?? "المركز الرئيسي", (byProject.get(l.project?.code ?? "المركز الرئيسي") ?? 0) + l.net);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl">
            مسير رواتب <span className="num">{run.month}</span>
          </h2>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {run.status === "DRAFT" && can(user.role, "payroll.approve") && (
            <form action={approvePayroll.bind(null, run.id)}>
              <button className="btn">اعتماد المسير</button>
            </form>
          )}
          {run.status === "DRAFT" && can(user.role, "hr.manage") && (
            <form action={deletePayroll.bind(null, run.id)}>
              <button className="btn-secondary">حذف المسودة</button>
            </form>
          )}
          {run.status === "APPROVED" && can(user.role, "payroll.pay") && (
            <form action={payPayroll.bind(null, run.id)} className="flex items-end gap-2">
              <CashAccountSelect />
              <button className="btn">تسجيل الصرف</button>
            </form>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-600">
        التوزيع على المواقع: {[...byProject].map(([k, v]) => `${k} ${fmtMoney(v)}`).join("، ")}. أجر ساعة الإضافي = الأساسي ÷ 30 ÷ 8 × 1.5.
      </p>
      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الموظف</th>
              <th>الموقع</th>
              <th>أيام العمل</th>
              <th>ساعات إضافي</th>
              <th>الأساسي</th>
              <th>البدلات</th>
              <th>الإضافي</th>
              <th>الخصومات</th>
              <th>الصافي</th>
              {editable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {run.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.employee.name}
                  <div className="text-xs text-slate-500">
                    {l.employee.code} · {l.employee.jobTitle}
                  </div>
                </td>
                <td>{l.project?.code ?? "المركز الرئيسي"}</td>
                {editable ? (
                  <>
                    <td colSpan={2}>
                      <form id={`f-${l.id}`} action={updatePayrollLine.bind(null, run.id, l.id)} className="flex gap-1">
                        <input name="daysWorked" type="number" min="0" max="30" step="0.5" defaultValue={l.daysWorked} className="w-20" aria-label="أيام العمل" />
                        <input name="overtimeHours" type="number" min="0" step="0.5" defaultValue={l.overtimeHours} className="w-20" aria-label="ساعات الإضافي" />
                      </form>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="num">{l.daysWorked}</td>
                    <td className="num">{l.overtimeHours}</td>
                  </>
                )}
                <td className="num">{fmtMoney(l.basic)}</td>
                <td className="num">{fmtMoney(l.allowances)}</td>
                <td className="num">{fmtMoney(l.overtimePay)}</td>
                <td className="num">
                  {editable ? (
                    <input form={`f-${l.id}`} name="deductions" type="number" min="0" step="0.01" defaultValue={l.deductions} className="w-24" aria-label="الخصومات" />
                  ) : (
                    fmtMoney(l.deductions)
                  )}
                </td>
                <td className="num font-semibold">{fmtMoney(l.net)}</td>
                {editable && (
                  <td>
                    <button form={`f-${l.id}`} className="btn-secondary px-2 py-1">
                      حفظ
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={4}>الإجمالي</td>
              <td className="num">{fmtMoney(total("basic"))}</td>
              <td className="num">{fmtMoney(total("allowances"))}</td>
              <td className="num">{fmtMoney(total("overtimePay"))}</td>
              <td className="num">{fmtMoney(total("deductions"))}</td>
              <td className="num">{fmtMoney(total("net"))}</td>
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
