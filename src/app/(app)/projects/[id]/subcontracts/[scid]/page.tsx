import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { billableQuantities } from "@/lib/ipc-service";
import { fmtDate, fmtMoney, fmtPct, fmtQty, todayStr } from "@/lib/format";
import { createSubCertificate, deleteSubCertificate, moveSubCertificate } from "@/app/actions/subcontracts";
import { Flash, StatusBadge } from "@/components/ui";
import { CashAccountSelect } from "@/components/cash-select";
import type { SearchParams } from "@/lib/flash";

export default async function SubcontractPage({ params, searchParams }: { params: Promise<{ id: string; scid: string }>; searchParams: SearchParams }) {
  const { id, scid } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id, "money.view", { page: true });
  const sc = await db.subcontract.findFirst({
    where: { id: scid, projectId: id },
    include: {
      subcontractor: true,
      lines: { include: { boqItem: true } },
      certificates: { include: { lines: true }, orderBy: { number: "desc" } },
    },
  });
  if (!sc) notFound();
  const { billable } = await billableQuantities(id);
  const last = sc.certificates[0];
  const lastQty = new Map(last?.lines.map((l) => [l.lineId, l.cumulativeQty]) ?? []);
  const canCert = can(user.role, "sub.manage") && !sc.certificates.some((c) => c.status === "DRAFT");

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div>
        <h2 className="text-xl">
          SC-{sc.number} · {sc.subcontractor.name} ({sc.subcontractor.category})
        </h2>
        <p className="text-sm text-slate-500">
          {sc.scope} · محتجز {sc.retentionPct}% · ضريبة {sc.vatPct}%
        </p>
      </div>

      <form action={createSubCertificate.bind(null, id, scid)} className="card space-y-4 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>البند</th>
              <th>الوصف</th>
              <th>كمية العقد</th>
              <th>سعرنا</th>
              <th>سعر الباطن</th>
              <th>الهامش</th>
              <th>المستخلص له سابقا</th>
              <th>الحد الأقصى الآن</th>
              {canCert && <th>الكمية التراكمية للمستخلص الجديد</th>}
            </tr>
          </thead>
          <tbody>
            {sc.lines.map((l) => {
              const cap = Math.min(billable.get(l.boqItemId) ?? 0, l.quantity);
              const margin = l.boqItem.rate > 0 ? (l.boqItem.rate - l.rate) / l.boqItem.rate : 0;
              return (
                <tr key={l.id}>
                  <td className="num">{l.boqItem.itemNo}</td>
                  <td>{l.boqItem.description}</td>
                  <td className="num">
                    {fmtQty(l.quantity)} {l.boqItem.unit}
                  </td>
                  <td className="num">{fmtMoney(l.boqItem.rate)}</td>
                  <td className="num">{fmtMoney(l.rate)}</td>
                  <td className={`num ${margin < 0.05 ? "font-semibold text-red-700" : ""}`}>{fmtPct(margin)}</td>
                  <td className="num">{fmtQty(lastQty.get(l.id) ?? 0)}</td>
                  <td className="num" title="ما استُلم منا من المالك، بحد أقصى كمية عقد الباطن">
                    {fmtQty(cap)}
                  </td>
                  {canCert && (
                    <td className="w-40">
                      <input name={`cum_${l.id}`} type="number" min="0" step="0.001" max={cap} defaultValue={cap} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {canCert && (
          <div className="flex flex-wrap items-end gap-3">
            <p className="w-full text-sm text-slate-500">لا يقبل النظام كمية لمقاول الباطن أكبر مما استُلم منا من الاستشاري للبند نفسه.</p>
            <div>
              <label>نهاية الفترة</label>
              <input name="periodTo" type="date" defaultValue={todayStr()} />
            </div>
            <button className="btn">إعداد مستخلص الباطن</button>
          </div>
        )}
      </form>

      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>المستخلص</th>
              <th>حتى تاريخ</th>
              <th>الحالة</th>
              <th>أعمال الفترة</th>
              <th>المحتجز</th>
              <th>الضريبة</th>
              <th>الصافي</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sc.certificates.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد مستخلصات بعد.
                </td>
              </tr>
            )}
            {sc.certificates.map((c) => (
              <tr key={c.id}>
                <td>رقم {c.number}</td>
                <td className="num">{fmtDate(c.periodTo)}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td className="num">{fmtMoney(c.currentGross)}</td>
                <td className="num">{fmtMoney(c.retention)}</td>
                <td className="num">{fmtMoney(c.vat)}</td>
                <td className="num font-semibold">{fmtMoney(c.netPayable)}</td>
                <td className="flex gap-2">
                  {c.status === "DRAFT" && can(user.role, "sub.approve") && (
                    <form action={moveSubCertificate.bind(null, id, scid, c.id, "APPROVED")}>
                      <button className="btn-secondary">اعتماد</button>
                    </form>
                  )}
                  {c.status === "DRAFT" && can(user.role, "sub.manage") && (
                    <form action={deleteSubCertificate.bind(null, id, scid, c.id)}>
                      <button className="text-xs text-red-600 hover:underline">حذف</button>
                    </form>
                  )}
                  {c.status === "APPROVED" && can(user.role, "sub.markPaid") && (
                    <form action={moveSubCertificate.bind(null, id, scid, c.id, "PAID")} className="flex gap-2">
                      <CashAccountSelect />
                      <button className="btn-secondary whitespace-nowrap">تسجيل الدفع</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
