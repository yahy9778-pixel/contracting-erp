import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, projectScope } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { projectSummary } from "@/lib/metrics";
import { projectAlerts } from "@/lib/alerts";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";

export default async function Dashboard() {
  const user = await requireUser();
  const showMoney = can(user.role, "money.view");
  const projects = await db.project.findMany({
    where: projectScope(user),
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });
  const rows = await Promise.all(projects.map(async (p) => ({ p, s: await projectSummary(p.id), a: await projectAlerts(p.id, { money: showMoney }) })));

  return (
    <>
      <PageHeader
        title="المشاريع"
        sub="ملخص لحظي لكل مشروع من التقارير اليومية المعتمدة والمستخلصات"
        actions={
          can(user.role, "projects.manage") && (
            <Link href="/projects/new" className="btn">
              مشروع جديد
            </Link>
          )
        }
      />
      {rows.length === 0 ? (
        <Empty>لا توجد مشاريع مسندة إليك بعد.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>المشروع</th>
                <th>المالك</th>
                <th>الحالة</th>
                {showMoney && <th>قيمة العقد</th>}
                {showMoney && <th>المنفذ المعتمد</th>}
                <th>نسبة الإنجاز</th>
                <th>تنبيهات</th>
                {showMoney && <th>آخر مستخلص</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, s, a }) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${p.id}`} className="font-semibold text-brand-700 hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-slate-500">{p.code}</div>
                  </td>
                  <td>{p.client.name}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  {showMoney && <td className="num">{fmtMoney(p.contractValue)}</td>}
                  {showMoney && <td className="num">{fmtMoney(s.executedValue)}</td>}
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, s.progress * 100)}%` }} />
                      </div>
                      <span className="num text-xs">{fmtPct(s.progress)}</span>
                    </div>
                  </td>
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
