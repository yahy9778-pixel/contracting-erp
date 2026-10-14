import Link from "next/link";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtMoney } from "@/lib/format";
import { createSubcontract } from "@/app/actions/subcontracts";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const ROWS = Array.from({ length: 8 }, (_, i) => i);
const CATEGORIES: [string, string][] = [
  ["D1", "أعمال ترابية"],
  ["D2", "خوازيق"],
  ["D3", "خرسانة"],
  ["D4", "هياكل معدنية"],
  ["D5", "تشطيبات"],
  ["D6", "كهرباء"],
  ["D7", "ميكانيكا"],
  ["D8", "تيار خفيف"],
  ["D9", "مرافق تحت الأرض"],
  ["D10", "تنسيق موقع"],
  ["D11", "ديكور"],
];

export default async function SubcontractsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id, "money.view", { page: true });
  const [subs, items] = await Promise.all([
    db.subcontract.findMany({
      where: { projectId: id },
      include: { subcontractor: true, lines: true, certificates: true },
      orderBy: { number: "asc" },
    }),
    db.boqItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
  ]);

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />
      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>العقد</th>
              <th>المقاول</th>
              <th>النطاق</th>
              <th>قيمة العقد</th>
              <th>المستخلص له</th>
              <th>المدفوع</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">
                  لا توجد عقود باطن.
                </td>
              </tr>
            )}
            {subs.map((s) => {
              const value = s.lines.reduce((x, l) => x + l.quantity * l.rate, 0);
              const certified = Math.max(0, ...s.certificates.filter((c) => c.status !== "DRAFT").map((c) => c.grossCumulative));
              const paid = s.certificates.filter((c) => c.status === "PAID").reduce((x, c) => x + c.netPayable, 0);
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${id}/subcontracts/${s.id}`} className="num font-semibold text-brand-700 hover:underline">
                      SC-{s.number}
                    </Link>
                  </td>
                  <td>
                    {s.subcontractor.name} <span className="text-xs text-slate-500">({s.subcontractor.category})</span>
                  </td>
                  <td>{s.scope}</td>
                  <td className="num">{fmtMoney(value)}</td>
                  <td className="num">{fmtMoney(certified)}</td>
                  <td className="num">{fmtMoney(paid)}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {can(user.role, "sub.manage") && (
        <form action={createSubcontract.bind(null, id)} className="card space-y-4">
          <h2>عقد باطن جديد</h2>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label>مقاول الباطن</label>
              <input name="subcontractor" required />
            </div>
            <div>
              <label>التخصص</label>
              <select name="category">
                {CATEGORIES.map(([c, l]) => (
                  <option key={c} value={c}>
                    {c} {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>المحتجز %</label>
              <input name="retentionPct" type="number" step="0.01" defaultValue="10" />
            </div>
            <div>
              <label>الضريبة %</label>
              <input name="vatPct" type="number" step="0.01" defaultValue="15" />
            </div>
            <div className="md:col-span-5">
              <label>نطاق العمل</label>
              <input name="scope" required placeholder="أعمال الهيكل الخرساني للأدوار من الأرضي حتى الرابع" />
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2">
            <span className="col-span-4 text-xs text-slate-500">بند جدول الكميات</span>
            <span className="text-xs text-slate-500">الكمية</span>
            <span className="text-xs text-slate-500">سعر الباطن</span>
            {ROWS.map((i) => (
              <div key={i} className="contents">
                <select name={`item_${i}`} defaultValue="" className="col-span-4">
                  <option value="">—</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.itemNo} · {it.description} ({it.unit}) · سعرنا {fmtMoney(it.rate)}
                    </option>
                  ))}
                </select>
                <input name={`qty_${i}`} type="number" min="0" step="0.001" />
                <input name={`rate_${i}`} type="number" min="0" step="0.01" />
              </div>
            ))}
          </div>
          <button className="btn">حفظ العقد</button>
        </form>
      )}
    </div>
  );
}
