import Link from "next/link";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { departmentsFor } from "@/lib/agents/departments";
import type { DepartmentReport } from "@/lib/agents/department-agent";
import { runAgent } from "@/app/actions/agents";
import { Flash } from "@/components/ui";

const STATUS: Record<string, [string, string]> = {
  ON_TRACK: ["حسب الخطة", "bg-emerald-100 text-emerald-800"],
  WATCH: ["تحت المراقبة", "bg-amber-100 text-amber-800"],
  CRITICAL: ["حرج", "bg-red-100 text-red-800"],
};
const SEVERITY: Record<string, string> = { HIGH: "bg-red-600", MEDIUM: "bg-amber-500", LOW: "bg-slate-400" };

type Search = Promise<{ error?: string; notice?: string; data?: string }>;

export default async function AgentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const { id } = await params;
  const { error, notice, data } = await searchParams;
  const { user } = await requireProjectAccess(id, "agents.view", { page: true });
  const departments = departmentsFor(user.role);
  const reports = await db.agentReport.findMany({ where: { projectId: id, department: { in: departments.map((d) => d.key) } }, orderBy: { createdAt: "desc" } });
  const latest = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latest.has(r.department)) latest.set(r.department, r);
  const enabled = Boolean(process.env.ANTHROPIC_API_KEY);
  const shown = departments.find((d) => d.key === data);
  const snapshot = shown ? await shown.collect(id) : null;

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <p className={`rounded-lg border px-4 py-3 text-sm ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {enabled
          ? "لكل قسم وكيل يقرأ بيانات المشروع الحية ويكتب تقرير متابعة بالأولويات والإجراءات والمسؤول عن كل إجراء. الوكيل يقترح فقط ولا ينفذ شيئا."
          : "الوكلاء جاهزون لكن غير مفعلين: يحتاجون مفتاح ANTHROPIC_API_KEY في إعدادات الخادم. يمكنك الآن رؤية مهام كل وكيل والبيانات التي سيقرؤها."}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {departments.map((d) => {
          const r = latest.get(d.key);
          const report = r ? (JSON.parse(r.output) as DepartmentReport) : null;
          return (
            <section key={d.key} id={d.key} className="card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2>وكيل {d.name}</h2>
                  <ul className="mt-1 list-inside list-disc text-xs text-slate-500">
                    {d.duties.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
                <form action={runAgent.bind(null, id, d.key)}>
                  <button className="btn whitespace-nowrap" disabled={!enabled}>
                    {report ? "تحديث التقرير" : "تشغيل الوكيل"}
                  </button>
                </form>
              </div>

              {report ? (
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${STATUS[report.status]?.[1]}`}>{STATUS[report.status]?.[0]}</span>
                    <span className="text-xs text-slate-500">{r!.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  </div>
                  <p className="font-semibold">{report.headline}</p>
                  {report.kpis.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {report.kpis.map((k) => (
                        <span key={k.label} className="rounded-md bg-slate-100 px-2 py-1 text-xs">
                          {k.label}: <span className="num font-semibold">{k.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <ul className="space-y-2">
                    {report.findings.map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY[f.severity]}`} />
                        <div>
                          <div className="font-semibold">{f.title}</div>
                          <div className="text-xs text-slate-500">{f.evidence}</div>
                          <div>
                            ← {f.action} <span className="text-xs text-slate-500">({f.owner}{f.due ? ` · ${f.due}` : ""})</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {report.questions.length > 0 && (
                    <div className="text-sm">
                      <div className="font-semibold">يحتاج معلومات:</div>
                      <ul className="list-inside list-disc text-slate-600">
                        {report.questions.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">لم يُشغّل بعد.</p>
              )}
              <Link href={`?data=${d.key}#${d.key}`} className="inline-block text-xs text-brand-700 hover:underline">
                عرض البيانات التي يقرؤها الوكيل
              </Link>
              {shown?.key === d.key && snapshot && (
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100" dir="ltr">
                  {JSON.stringify(snapshot, null, 2)}
                </pre>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
