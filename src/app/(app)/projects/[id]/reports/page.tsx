import Link from "next/link";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { executedQuantities } from "@/lib/ipc-service";
import { fmtDate } from "@/lib/format";
import { createReport, draftReportWithAgent } from "@/app/actions/reports";
import { ReportForm } from "@/components/report-form";
import { Empty, Flash, StatusBadge } from "@/components/ui";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; new?: string }>;
}) {
  const { id } = await params;
  const { error, notice, new: showForm } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const canCreate = can(user.role, "report.create");
  const [reports, items, executed] = await Promise.all([
    db.dailyReport.findMany({
      where: { projectId: id },
      orderBy: { date: "desc" },
      include: { createdBy: true, _count: { select: { progress: true } }, manpower: true },
    }),
    db.boqItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
    executedQuantities(id),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const agentReady = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />

      {canCreate && (
        <div className="grid gap-6 lg:grid-cols-3">
          <form action={draftReportWithAgent.bind(null, id)} className="card space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2>وكيل التقرير اليومي</h2>
              <span className={`badge ${agentReady ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                {agentReady ? "مفعل" : "غير مفعل: يحتاج مفتاح Claude API"}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              اكتب أو الصق رسالة الموقع كما هي، وسيحولها الوكيل إلى مسودة تقرير مطابقة لبنود جدول الكميات. المسودة لا تُعتمد إلا بعد مراجعتك.
            </p>
            <textarea
              name="text"
              rows={5}
              required
              placeholder="مثال: اليوم صبينا قواعد المحور A بحوالي 45 متر مكعب، وحفرنا 300 متر مكعب في الجهة الشمالية. العمالة 12 نجار و8 حداد و20 عامل. شغالة حفارة وحدة 8 ساعات ولودر. نحتاج حديد 16 مم بكرة."
            />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label>تاريخ التقرير</label>
                <input name="date" type="date" defaultValue={today} />
              </div>
              <button className="btn" disabled={!agentReady}>
                جهّز المسودة بالوكيل
              </button>
            </div>
          </form>
          <div className="card flex flex-col justify-between gap-3">
            <div>
              <h2>إدخال يدوي</h2>
              <p className="mt-1 text-sm text-slate-500">املأ نموذج التقرير بنفسك.</p>
            </div>
            <Link href={`/projects/${id}/reports?new=1`} className="btn-secondary">
              تقرير جديد يدويا
            </Link>
          </div>
        </div>
      )}

      {canCreate && showForm && (
        <div>
          <h2 className="mb-3">تقرير يومي جديد</h2>
          <ReportForm action={createReport.bind(null, id)} items={items} executed={executed} defaults={{ date: today }} submitLabel="حفظ كمسودة" />
        </div>
      )}

      {reports.length === 0 ? (
        <Empty>لا توجد تقارير يومية بعد.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الحالة</th>
                <th>المصدر</th>
                <th>بنود منفذة</th>
                <th>العمالة</th>
                <th>بواسطة</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${id}/reports/${r.id}`} className="num font-semibold text-brand-700 hover:underline">
                      {fmtDate(r.date)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{r.source === "AGENT" ? "الوكيل الذكي" : "يدوي"}</td>
                  <td>{r._count.progress}</td>
                  <td>{r.manpower.reduce((s, m) => s + m.count, 0)}</td>
                  <td>{r.createdBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

