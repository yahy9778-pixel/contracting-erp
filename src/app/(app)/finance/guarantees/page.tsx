import Link from "next/link";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { GUARANTEE_TYPES, daysBetween, fmtDate, fmtMoney, parseDay, todayStr } from "@/lib/format";
import { StatusBadge } from "@/components/ui";
import { guaranteeState } from "@/lib/guarantees";

export default async function GuaranteesPage() {
  await requirePagePermission("finance.view");
  const today = parseDay(todayStr());
  const list = await db.bankGuarantee.findMany({ include: { project: true }, orderBy: [{ status: "asc" }, { expiryDate: "asc" }] });
  const active = list.filter((g) => g.status === "ACTIVE");
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        إجمالي الضمانات القائمة <span className="num font-semibold">{fmtMoney(active.reduce((s, g) => s + g.amount, 0))}</span>. التسجيل والتمديد والإفراج من
        تبويب "التكاليف والمالية" في كل مشروع.
      </p>
      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>المشروع</th>
              <th>النوع</th>
              <th>البنك</th>
              <th>الرقم</th>
              <th>المبلغ</th>
              <th>ينتهي في</th>
              <th>متبقي</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد خطابات ضمان مسجلة.
                </td>
              </tr>
            )}
            {list.map((g) => (
              <tr key={g.id}>
                <td>
                  <Link href={`/projects/${g.projectId}/finance`} className="text-brand-700 hover:underline">
                    {g.project.code}
                  </Link>
                </td>
                <td>{GUARANTEE_TYPES[g.type] ?? g.type}</td>
                <td>{g.bank}</td>
                <td className="num">{g.number}</td>
                <td className="num">{fmtMoney(g.amount)}</td>
                <td className="num">{fmtDate(g.expiryDate)}</td>
                <td className="num">{g.status === "ACTIVE" ? `${daysBetween(today, g.expiryDate)} يوم` : "—"}</td>
                <td>
                  <StatusBadge status={guaranteeState(g, today)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
