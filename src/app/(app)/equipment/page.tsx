import { db } from "@/lib/db";
import { projectScope, requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney, fmtQty, todayStr } from "@/lib/format";
import { serviceStatus } from "@/lib/operations";
import { assignEquipment, closeWorkOrder, createEquipment, logUsage, openWorkOrder } from "@/app/actions/equipment";
import { CashAccountSelect } from "@/components/cash-select";
import { Flash, PageHeader, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const COST_CODES: Record<string, string> = { E3: "معدات", F2: "نقل أفقي", F3: "نقل رأسي" };
const EQ_STATUS: Record<string, [string, string]> = {
  ACTIVE: ["تعمل في الموقع", "bg-emerald-100 text-emerald-800"],
  IDLE: ["متوقفة", "bg-slate-100 text-slate-600"],
  MAINTENANCE: ["في الورشة", "bg-amber-100 text-amber-800"],
};

export default async function EquipmentPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("equipment.view");
  const { error, notice } = await searchParams;
  const scope = projectScope(user);
  const [equipment, usages, orders, projects] = await Promise.all([
    db.equipment.findMany({ include: { project: true, supplier: true }, orderBy: { code: "asc" } }),
    db.equipmentUsage.findMany({ where: { project: scope }, include: { equipment: true, project: true }, orderBy: { date: "desc" }, take: 30 }),
    db.workOrder.findMany({ include: { equipment: true }, orderBy: [{ status: "desc" }, { number: "desc" }], take: 30 }),
    db.project.findMany({ where: scope, orderBy: { code: "asc" } }),
  ]);
  const canManage = can(user.role, "equipment.manage");
  const showMoney = canManage || can(user.role, "money.view");
  const myProjects = new Set(projects.map((p) => p.id));
  const loggable = equipment.filter((e) => e.projectId && myProjects.has(e.projectId) && e.status === "ACTIVE");

  return (
    <div className="space-y-8">
      <PageHeader title="المعدات والورشة" sub="مكان كل معدة، ساعات تشغيلها وتكلفتها على المشاريع، ومواعيد صيانتها" />
      <Flash error={error} notice={notice} />

      <section className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>المعدة</th>
              <th>الملكية</th>
              <th>الموقع</th>
              <th>الحالة</th>
              <th>العداد</th>
              <th>الصيانة القادمة</th>
              {showMoney && <th>تكلفة الساعة</th>}
              {canManage && <th>نقل إلى</th>}
            </tr>
          </thead>
          <tbody>
            {equipment.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد معدات مسجلة.
                </td>
              </tr>
            )}
            {equipment.map((e) => {
              const svc = serviceStatus(e.meterHours, e.lastServiceAt, e.serviceInterval);
              return (
                <tr key={e.id}>
                  <td>
                    <span className="num text-xs text-slate-500">{e.code}</span> {e.name}
                    <div className="text-xs text-slate-500">{COST_CODES[e.costCode] ?? e.costCode}</div>
                  </td>
                  <td>{e.ownership === "OWNED" ? "مملوكة" : `مستأجرة من ${e.supplier?.name ?? "—"}`}</td>
                  <td>{e.project?.code ?? "الساحة الرئيسية"}</td>
                  <td>
                    <span className={`badge ${EQ_STATUS[e.status]?.[1] ?? ""}`}>{EQ_STATUS[e.status]?.[0] ?? e.status}</span>
                  </td>
                  <td className="num">{fmtQty(e.meterHours)} س</td>
                  <td className={`num ${svc.due ? "font-semibold text-red-700" : ""}`}>
                    {svc.remaining === null ? "—" : svc.due ? `متأخرة ${fmtQty(-svc.remaining)} س` : `بعد ${fmtQty(svc.remaining)} س`}
                  </td>
                  {showMoney && <td className="num">{fmtMoney(e.hourlyRate)}</td>}
                  {canManage && (
                    <td>
                      <form action={assignEquipment.bind(null, e.id)} className="flex gap-1">
                        <select name="projectId" defaultValue={e.projectId ?? ""} className="w-auto">
                          <option value="">الساحة الرئيسية</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code}
                            </option>
                          ))}
                        </select>
                        <button className="btn-secondary px-2 py-1">نقل</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {can(user.role, "equipment.log") && (
          <form action={logUsage} className="card space-y-3">
            <h2>تسجيل ساعات تشغيل</h2>
            <div className="grid grid-cols-2 gap-3">
              <select name="equipmentId" required defaultValue="" className="col-span-2">
                <option value="" disabled>
                  المعدة (العاملة في مواقعك)
                </option>
                {loggable.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name} · {e.project?.code}
                  </option>
                ))}
              </select>
              <input name="hours" type="number" min="0.5" max="24" step="0.5" placeholder="الساعات" required />
              <input name="date" type="date" defaultValue={todayStr()} />
              <input name="operator" placeholder="المشغل" />
              <input name="notes" placeholder="العمل المنفذ" />
            </div>
            <button className="btn">تسجيل</button>
          </form>
        )}

        {canManage && (
          <form action={openWorkOrder} className="card space-y-3">
            <h2>أمر عمل للورشة</h2>
            <div className="grid grid-cols-2 gap-3">
              <select name="equipmentId" required defaultValue="">
                <option value="" disabled>
                  المعدة
                </option>
                {equipment
                  .filter((e) => e.status !== "MAINTENANCE")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} · {e.name}
                    </option>
                  ))}
              </select>
              <select name="kind">
                <option value="PREVENTIVE">صيانة وقائية</option>
                <option value="BREAKDOWN">إصلاح عطل</option>
              </select>
              <input name="description" placeholder="وصف العمل المطلوب" required className="col-span-2" />
            </div>
            <button className="btn">فتح أمر العمل</button>
          </form>
        )}
      </div>

      <section className="space-y-3">
        <h2>أوامر عمل الورشة</h2>
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>المعدة</th>
                <th>النوع</th>
                <th>الوصف</th>
                <th>الحالة</th>
                <th>الإغلاق</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    لا توجد أوامر عمل.
                  </td>
                </tr>
              )}
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="num">WO-{o.number}</td>
                  <td>{o.equipment.code}</td>
                  <td>{o.kind === "PREVENTIVE" ? "وقائية" : "عطل"}</td>
                  <td>{o.description}</td>
                  <td>
                    <StatusBadge status={o.status === "OPEN" ? "OPEN" : "CLOSED"} />
                  </td>
                  <td className="min-w-96">
                    {o.status === "OPEN" && canManage ? (
                      <form action={closeWorkOrder.bind(null, o.id)} className="flex flex-wrap gap-1">
                        <input name="resolution" placeholder="ما تم إصلاحه" required className="w-40" />
                        <input name="cost" type="number" min="0" step="0.01" placeholder="التكلفة" className="w-24" />
                        <CashAccountSelect />
                        <button className="btn-secondary px-2 py-1">إغلاق</button>
                      </form>
                    ) : (
                      <span className="text-sm">
                        {o.resolution ?? "—"}
                        {showMoney && o.cost > 0 && <span className="num text-slate-500"> · {fmtMoney(o.cost)}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2>آخر ساعات التشغيل</h2>
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المعدة</th>
                <th>المشروع</th>
                <th>الساعات</th>
                {showMoney && <th>التكلفة</th>}
                <th>المشغل / العمل</th>
              </tr>
            </thead>
            <tbody>
              {usages.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    لا توجد ساعات مسجلة.
                  </td>
                </tr>
              )}
              {usages.map((u) => (
                <tr key={u.id}>
                  <td className="num">{fmtDate(u.date)}</td>
                  <td>
                    {u.equipment.code} {u.equipment.name}
                  </td>
                  <td>{u.project.code}</td>
                  <td className="num">{fmtQty(u.hours)}</td>
                  {showMoney && <td className="num">{fmtMoney(u.hours * u.rate)}</td>}
                  <td className="text-sm">{[u.operator, u.notes].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && (
        <form action={createEquipment} className="card grid gap-3 md:grid-cols-5">
          <h2 className="md:col-span-5">معدة جديدة</h2>
          <input name="code" placeholder="الرمز" required />
          <input name="name" placeholder="الاسم" required />
          <select name="costCode" defaultValue="E3">
            {Object.entries(COST_CODES).map(([k, v]) => (
              <option key={k} value={k}>
                {k} · {v}
              </option>
            ))}
          </select>
          <select name="ownership" defaultValue="OWNED">
            <option value="OWNED">مملوكة</option>
            <option value="RENTED">مستأجرة</option>
          </select>
          <input name="supplier" placeholder="المؤجر (للمستأجرة)" />
          <input name="hourlyRate" type="number" min="0.01" step="0.01" placeholder="تكلفة الساعة" required />
          <input name="serviceInterval" type="number" min="0" step="1" placeholder="صيانة كل (ساعة)" />
          <input name="meterHours" type="number" min="0" step="0.1" placeholder="قراءة العداد الحالية" />
          <select name="projectId" defaultValue="">
            <option value="">الساحة الرئيسية</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
          <button className="btn">إضافة</button>
        </form>
      )}
    </div>
  );
}
