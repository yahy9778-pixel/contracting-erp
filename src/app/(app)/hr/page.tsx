import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { daysBetween, fmtDate, fmtMoney, parseDay, todayStr } from "@/lib/format";
import { DOC_WARNING_DAYS } from "@/lib/guarantees";
import { createEmployee, updateEmployee } from "@/app/actions/hr";
import { Flash } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("hr.view");
  const { error, notice } = await searchParams;
  const today = parseDay(todayStr());
  const [employees, projects] = await Promise.all([
    db.employee.findMany({ include: { project: true }, orderBy: [{ active: "desc" }, { code: "asc" }] }),
    db.project.findMany({ orderBy: { code: "asc" } }),
  ]);
  const canManage = can(user.role, "hr.manage");
  const active = employees.filter((e) => e.active);
  const monthly = active.reduce((s, e) => s + e.basicSalary + e.allowances, 0);
  const byProject = new Map<string, number>();
  for (const e of active) byProject.set(e.project?.code ?? "المركز الرئيسي", (byProject.get(e.project?.code ?? "المركز الرئيسي") ?? 0) + 1);

  const Fields = ({ e }: { e?: (typeof employees)[number] }) => (
    <>
      <input name="jobTitle" placeholder="المسمى الوظيفي" defaultValue={e?.jobTitle} required />
      <select name="kind" defaultValue={e?.kind ?? "LABOR"}>
        <option value="LABOR">عامل</option>
        <option value="STAFF">موظف</option>
      </select>
      <input name="trade" placeholder="المهنة" defaultValue={e?.trade ?? ""} />
      <input name="basicSalary" type="number" min="1" step="0.01" placeholder="الراتب الأساسي" defaultValue={e?.basicSalary} required />
      <input name="allowances" type="number" min="0" step="0.01" placeholder="البدلات" defaultValue={e?.allowances ?? 0} />
      <select name="projectId" defaultValue={e?.projectId ?? ""}>
        <option value="">المركز الرئيسي</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code}
          </option>
        ))}
      </select>
      <input name="idExpiry" type="date" defaultValue={e?.idExpiry ? fmtDate(e.idExpiry) : ""} aria-label="انتهاء الإقامة / الهوية" />
    </>
  );

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <p className="text-sm text-slate-600">
        {active.length} موظف وعامل نشط · الرواتب الشهرية <span className="num font-semibold">{fmtMoney(monthly)}</span> ·{" "}
        {[...byProject].map(([k, v]) => `${k}: ${v}`).join("، ")}
      </p>

      {canManage && (
        <form action={createEmployee} className="card grid gap-3 md:grid-cols-5">
          <h2 className="md:col-span-5">موظف أو عامل جديد</h2>
          <input name="name" placeholder="الاسم" required />
          <input name="nationalId" placeholder="رقم الهوية / الإقامة" />
          <input name="joinDate" type="date" defaultValue={todayStr()} required aria-label="تاريخ المباشرة" />
          <Fields />
          <div className="md:col-span-5">
            <button className="btn">إضافة</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الرمز</th>
              <th>الاسم</th>
              <th>المسمى</th>
              <th>الموقع</th>
              <th>الراتب + البدلات</th>
              <th>انتهاء الإقامة</th>
              {canManage && <th>تعديل</th>}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">
                  لا يوجد موظفون بعد.
                </td>
              </tr>
            )}
            {employees.map((e) => {
              const left = e.idExpiry ? daysBetween(today, e.idExpiry) : null;
              return (
                <tr key={e.id} className={e.active ? "" : "text-slate-400"}>
                  <td className="num">{e.code}</td>
                  <td>
                    {e.name}
                    {!e.active && <span className="badge ms-2 bg-slate-100">غير نشط</span>}
                  </td>
                  <td>
                    {e.jobTitle}
                    <div className="text-xs text-slate-500">{e.kind === "STAFF" ? "موظف" : "عامل"}{e.trade && ` · ${e.trade}`}</div>
                  </td>
                  <td>{e.project?.code ?? "المركز الرئيسي"}</td>
                  <td className="num">
                    {fmtMoney(e.basicSalary)} + {fmtMoney(e.allowances)}
                  </td>
                  <td className={`num ${left !== null && left <= DOC_WARNING_DAYS ? "font-semibold text-red-700" : ""}`}>
                    {fmtDate(e.idExpiry)}
                    {left !== null && left <= DOC_WARNING_DAYS && <div className="text-xs">{left < 0 ? "منتهية" : `باقي ${left} يوم`}</div>}
                  </td>
                  {canManage && (
                    <td className="min-w-[40rem]">
                      <details>
                        <summary className="cursor-pointer text-sm text-brand-700">تعديل</summary>
                        <form action={updateEmployee.bind(null, e.id)} className="mt-2 grid grid-cols-4 gap-2">
                          <Fields e={e} />
                          <select name="active" defaultValue={e.active ? "yes" : "no"}>
                            <option value="yes">نشط</option>
                            <option value="no">انتهت خدمته</option>
                          </select>
                          <button className="btn-secondary">حفظ</button>
                        </form>
                      </details>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
