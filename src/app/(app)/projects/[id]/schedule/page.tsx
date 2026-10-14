import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { projectSchedule } from "@/lib/schedule-service";
import { fmtDate, fmtPct, parseDay, todayStr } from "@/lib/format";
import { createActivity, deleteActivity, generateFromBoq, updateActivity } from "@/app/actions/schedule";
import { Flash, Stat, StatusBadge } from "@/components/ui";
import { SCurve } from "@/components/s-curve";
import type { SearchParams } from "@/lib/flash";

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user, project } = await requireProjectAccess(id);
  const today = parseDay(todayStr());
  const [{ rows, summary, curve }, items] = await Promise.all([
    projectSchedule(id, today),
    db.boqItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
  ]);
  const canEdit = can(user.role, "schedule.edit");
  const totalWeight = rows.reduce((s, r) => s + r.a.weight, 0);
  const late = rows.filter((r) => r.status === "LATE" || r.status === "BEHIND");
  // نطاق الجدول لرسم أشرطة الأنشطة
  const span0 = Math.min(...rows.map((r) => r.a.startDate.getTime()), project.startDate?.getTime() ?? Infinity);
  const span1 = Math.max(...rows.map((r) => r.a.endDate.getTime()), project.endDate?.getTime() ?? -Infinity);
  const pos = (d: Date) => ((d.getTime() - span0) / Math.max(1, span1 - span0)) * 100;

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />

      {rows.length === 0 ? (
        <div className="card space-y-3 text-center">
          <p className="text-slate-600">لا يوجد جدول زمني لهذا المشروع بعد.</p>
          {canEdit && (
            <form action={generateFromBoq.bind(null, id)}>
              <button className="btn">إنشاء الأنشطة من جدول الكميات</button>
            </form>
          )}
          <p className="text-xs text-slate-500">ينشئ نشاطا لكل بند بوزن قيمته، ثم تعدّل تواريخ كل نشاط حسب خطة التنفيذ.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="الإنجاز المخطط حتى اليوم" value={<span className="num">{fmtPct(summary.planned)}</span>} />
            <Stat label="الإنجاز الفعلي" value={<span className="num">{fmtPct(summary.actual)}</span>} hint="من التقارير اليومية المعتمدة" />
            <Stat
              label="مؤشر الأداء الزمني SPI"
              value={
                <span className={`num ${summary.spi !== null && summary.spi < 0.9 ? "text-red-700" : summary.spi !== null && summary.spi >= 1 ? "text-emerald-700" : "text-amber-700"}`}>
                  {summary.spi === null ? "—" : summary.spi.toFixed(2)}
                </span>
              }
              hint="الفعلي ÷ المخطط. أقل من 1 يعني تأخرا"
            />
            <Stat label="أنشطة متأخرة أو خلف الخطة" value={<span className={`num ${late.length ? "text-red-700" : ""}`}>{late.length}</span>} />
          </div>

          <section className="card">
            <h2 className="mb-2">منحنى S</h2>
            <SCurve points={curve} today={today} />
          </section>
        </>
      )}

      {rows.length > 0 && (
        <section className="space-y-3">
          <h2>الأنشطة</h2>
          <div className="card overflow-x-auto p-0">
            <table>
              <thead>
                <tr>
                  <th>الرمز</th>
                  <th>النشاط</th>
                  <th>الوزن</th>
                  <th className="min-w-48">المدة</th>
                  <th>مخطط</th>
                  <th>فعلي</th>
                  <th>الحالة</th>
                  {canEdit && <th>تعديل</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, planned, actual, status }) => (
                  <tr key={a.id}>
                    <td className="num">{a.code}</td>
                    <td>
                      {a.name}
                      <div className="text-xs text-slate-500">{a.boqItem ? `مرتبط بالبند ${a.boqItem.itemNo}` : "إنجاز يدوي"}</div>
                    </td>
                    <td className="num">{fmtPct(totalWeight ? a.weight / totalWeight : 0)}</td>
                    <td>
                      <div className="relative h-3 rounded bg-slate-100" style={{ direction: "ltr" }}>
                        <div className="absolute h-3 rounded bg-brand-100" style={{ left: `${pos(a.startDate)}%`, width: `${Math.max(1, pos(a.endDate) - pos(a.startDate))}%` }} />
                        <div
                          className={`absolute h-3 rounded ${status === "LATE" ? "bg-red-500" : status === "BEHIND" ? "bg-amber-500" : "bg-brand-600"}`}
                          style={{ left: `${pos(a.startDate)}%`, width: `${Math.max(0, (pos(a.endDate) - pos(a.startDate)) * actual)}%` }}
                        />
                        {today.getTime() >= span0 && today.getTime() <= span1 && <div className="absolute h-3 w-px bg-slate-500" style={{ left: `${pos(today)}%` }} />}
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500" style={{ direction: "ltr" }}>
                        <span className="num">{fmtDate(a.startDate)}</span>
                        <span className="num">{fmtDate(a.endDate)}</span>
                      </div>
                    </td>
                    <td className="num">{fmtPct(planned)}</td>
                    <td className="num font-semibold">{fmtPct(actual)}</td>
                    <td>
                      <StatusBadge status={status} />
                    </td>
                    {canEdit && (
                      <td className="min-w-96">
                        <form action={updateActivity.bind(null, id, a.id)} className="flex flex-wrap items-center gap-1">
                          <input name="startDate" type="date" defaultValue={fmtDate(a.startDate)} className="w-36" aria-label="البداية" required />
                          <input name="endDate" type="date" defaultValue={fmtDate(a.endDate)} className="w-36" aria-label="النهاية" required />
                          {!a.boqItem && (
                            <input name="manualPct" type="number" min="0" max="100" step="1" defaultValue={Math.round((a.manualPct ?? 0) * 100)} className="w-20" aria-label="نسبة الإنجاز %" />
                          )}
                          <button className="btn-secondary px-2 py-1">حفظ</button>
                        </form>
                        <form action={deleteActivity.bind(null, id, a.id)}>
                          <button className="text-xs text-red-600 hover:underline">حذف</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canEdit && (
        <form action={createActivity.bind(null, id)} className="card grid gap-3 md:grid-cols-6">
          <h2 className="md:col-span-6">إضافة نشاط</h2>
          <div>
            <label>الرمز</label>
            <input name="code" required />
          </div>
          <div className="md:col-span-2">
            <label>الاسم</label>
            <input name="name" required />
          </div>
          <div>
            <label>البند المرتبط (اختياري)</label>
            <select name="boqItemId" defaultValue="">
              <option value="">بدون: إنجاز يدوي</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemNo} · {i.description}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>البداية</label>
            <input name="startDate" type="date" defaultValue={fmtDate(project.startDate)} required />
          </div>
          <div>
            <label>النهاية</label>
            <input name="endDate" type="date" defaultValue={fmtDate(project.endDate)} required />
          </div>
          <div>
            <label>الوزن (للنشاط غير المرتبط)</label>
            <input name="weight" type="number" min="0" step="0.01" placeholder="قيمته التقديرية" />
          </div>
          <div className="flex items-end md:col-span-5">
            <button className="btn">إضافة</button>
          </div>
        </form>
      )}
    </div>
  );
}
