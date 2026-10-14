import Link from "next/link";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney } from "@/lib/format";
import { generateIpc } from "@/app/actions/ipcs";
import { Empty, Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function IpcsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id, "money.view", { page: true });
  const ipcs = await db.paymentCertificate.findMany({ where: { projectId: id }, orderBy: { number: "desc" } });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      {can(user.role, "ipc.create") && (
        <form action={generateIpc.bind(null, id)} className="card flex flex-wrap items-end gap-4">
          <div>
            <h2>إعداد مستخلص جديد</h2>
            <p className="text-sm text-slate-500">يُحسب تلقائيا من كميات التقارير اليومية المعتمدة حتى نهاية الفترة.</p>
          </div>
          <div>
            <label>نهاية الفترة</label>
            <input name="periodTo" type="date" defaultValue={today} required />
          </div>
          <button className="btn">إعداد المستخلص</button>
        </form>
      )}
      {ipcs.length === 0 ? (
        <Empty>لا توجد مستخلصات بعد.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>نهاية الفترة</th>
                <th>الحالة</th>
                <th>الأعمال التراكمية</th>
                <th>أعمال الفترة</th>
                <th>الصافي المستحق</th>
                <th>المعتمد من الاستشاري</th>
              </tr>
            </thead>
            <tbody>
              {ipcs.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${id}/ipcs/${c.id}`} className="font-semibold text-brand-700 hover:underline">
                      مستخلص {c.number}
                    </Link>
                  </td>
                  <td className="num">{fmtDate(c.periodTo)}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="num">{fmtMoney(c.grossCumulative)}</td>
                  <td className="num">{fmtMoney(c.currentGross)}</td>
                  <td className="num font-semibold">{fmtMoney(c.netPayable)}</td>
                  <td className="num">{c.approvedAmount != null ? fmtMoney(c.approvedAmount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
