import Link from "next/link";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { projectSummary } from "@/lib/metrics";
import { projectAlerts } from "@/lib/alerts";
import { db } from "@/lib/db";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { Stat, StatusBadge } from "@/components/ui";

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, project } = await requireProjectAccess(id);
  const showMoney = can(user.role, "money.view");
  const [s, alerts] = await Promise.all([projectSummary(id), projectAlerts(id, { money: showMoney })]);
  const recent = await db.dailyReport.findMany({
    where: { projectId: id },
    orderBy: { date: "desc" },
    take: 5,
    include: { createdBy: true },
  });
  const mismatch = Math.abs(s.boqValue - project.contractValue) > 0.01;

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="mb-3">ما يحتاج متابعة</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-emerald-700">لا توجد بنود متأخرة أو معلقة.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {alerts.map((a) => (
              <li key={a.text} className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${a.level === "high" ? "bg-red-600" : "bg-amber-500"}`} />
                <Link href={a.href} className="hover:underline">
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {showMoney && <Stat label="قيمة العقد" value={<span className="num">{fmtMoney(project.contractValue)}</span>} />}
        {showMoney && <Stat label="قيمة المنفذ المعتمد" value={<span className="num">{fmtMoney(s.executedValue)}</span>} />}
        <Stat label="نسبة الإنجاز (بالقيمة)" value={<span className="num">{fmtPct(s.progress)}</span>} />
        <Stat label="تقارير بانتظار الاعتماد" value={s.pendingReports} />
        {showMoney && <Stat label="المحصل من المستخلصات" value={<span className="num">{fmtMoney(s.collected)}</span>} />}
      </div>

      {showMoney && mismatch && s.boqValue > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          تنبيه: إجمالي جدول الكميات (<span className="num">{fmtMoney(s.boqValue)}</span>) لا يساوي قيمة العقد.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-3">بيانات العقد</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">المالك</dt>
            <dd>{project.client.name}</dd>
            <dt className="text-slate-500">الاستشاري</dt>
            <dd>{project.consultant?.name ?? "—"}</dd>
            <dt className="text-slate-500">الموقع</dt>
            <dd>{project.location ?? "—"}</dd>
            <dt className="text-slate-500">البدء / الانتهاء</dt>
            <dd className="num">
              {fmtDate(project.startDate)} → {fmtDate(project.endDate)}
            </dd>
            {showMoney && (
              <>
                <dt className="text-slate-500">المحتجز / الضريبة</dt>
                <dd>
                  {project.retentionPct}% / {project.vatPct}%
                </dd>
                <dt className="text-slate-500">الدفعة المقدمة</dt>
                <dd className="num">{fmtMoney(project.advanceAmount)}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2>آخر التقارير اليومية</h2>
            <Link href={`/projects/${id}/reports`} className="text-sm text-brand-700 hover:underline">
              الكل
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد تقارير بعد.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <Link href={`/projects/${id}/reports/${r.id}`} className="num hover:underline">
                    {fmtDate(r.date)}
                  </Link>
                  <span className="text-slate-500">{r.createdBy.name}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
