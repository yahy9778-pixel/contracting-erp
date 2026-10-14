import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { executedQuantities } from "@/lib/ipc-service";
import { fmtDate, fmtQty } from "@/lib/format";
import { deleteReport, reviewReport, submitReport, updateReport } from "@/app/actions/reports";
import { ReportForm } from "@/components/report-form";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string; rid: string }>; searchParams: SearchParams }) {
  const { id, rid } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const report = await db.dailyReport.findFirst({
    where: { id: rid, projectId: id },
    include: {
      createdBy: true,
      approvedBy: true,
      manpower: true,
      equipment: true,
      progress: { include: { boqItem: true }, orderBy: { boqItem: { sortOrder: "asc" } } },
    },
  });
  if (!report) notFound();

  const editable =
    can(user.role, "report.create") &&
    ["DRAFT", "REJECTED"].includes(report.status) &&
    (report.createdById === user.id || can(user.role, "report.approve"));
  const canReview = can(user.role, "report.approve") && report.status === "SUBMITTED";

  const [items, executed] = editable
    ? await Promise.all([
        db.boqItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
        executedQuantities(id),
      ])
    : [[], new Map<string, number>()];

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="num text-xl">تقرير {fmtDate(report.date)}</h2>
          <StatusBadge status={report.status} />
          {report.source === "AGENT" && <span className="badge bg-violet-100 text-violet-800">جهّزه الوكيل الذكي</span>}
        </div>
        <div className="flex gap-2">
          {editable && (
            <>
              <form action={submitReport.bind(null, id, rid)}>
                <button className="btn">رفع للاعتماد</button>
              </form>
              <form action={deleteReport.bind(null, id, rid)}>
                <button className="btn-secondary">حذف المسودة</button>
              </form>
            </>
          )}
          {canReview && (
            <>
              <form action={reviewReport.bind(null, id, rid, "APPROVED")}>
                <button className="btn">اعتماد</button>
              </form>
              <form action={reviewReport.bind(null, id, rid, "REJECTED")}>
                <button className="btn-danger">رفض وإعادة</button>
              </form>
            </>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500">
        أعده {report.createdBy.name}
        {report.approvedBy && ` · راجعه ${report.approvedBy.name}`}
      </p>

      {report.rawText && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">النص الأصلي الذي أرسله الموقع</summary>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{report.rawText}</p>
        </details>
      )}

      {editable ? (
        <ReportForm
          action={updateReport.bind(null, id, rid)}
          items={items}
          executed={executed}
          dateEditable={false}
          submitLabel="حفظ التعديلات"
          defaults={{
            date: fmtDate(report.date),
            weather: report.weather,
            notes: report.notes,
            issues: report.issues,
            manpower: report.manpower,
            equipment: report.equipment,
            progress: new Map(report.progress.map((p) => [p.boqItemId, { quantity: p.quantity, location: p.location }])),
          }}
        />
      ) : (
        <>
          <div className="card grid gap-3 text-sm md:grid-cols-3">
            <div>
              <span className="text-slate-500">الطقس: </span>
              {report.weather ?? "—"}
            </div>
            <div className="md:col-span-2">
              <span className="text-slate-500">ملاحظات: </span>
              {report.notes ?? "—"}
            </div>
            {report.issues && (
              <div className="md:col-span-3 whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-amber-900">{report.issues}</div>
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-2">العمالة</h2>
              {report.manpower.length === 0 ? "—" : (
                <ul className="text-sm">
                  {report.manpower.map((m) => (
                    <li key={m.id}>
                      {m.trade}: {m.count}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h2 className="mb-2">المعدات</h2>
              {report.equipment.length === 0 ? "—" : (
                <ul className="text-sm">
                  {report.equipment.map((e) => (
                    <li key={e.id}>
                      {e.name}: {e.count}
                      {e.hours ? ` · ${e.hours} ساعة` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card overflow-x-auto p-0">
            <table>
              <thead>
                <tr>
                  <th>البند</th>
                  <th>الوصف</th>
                  <th>الكمية</th>
                  <th>الوحدة</th>
                  <th>الموقع</th>
                </tr>
              </thead>
              <tbody>
                {report.progress.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{p.boqItem.itemNo}</td>
                    <td>{p.boqItem.description}</td>
                    <td className="num">{fmtQty(p.quantity)}</td>
                    <td>{p.boqItem.unit}</td>
                    <td>{p.location ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
