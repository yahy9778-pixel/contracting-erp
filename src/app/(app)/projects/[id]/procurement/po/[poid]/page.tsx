import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney, fmtQty, todayStr } from "@/lib/format";
import { approvePo, cancelPo, receiveGoods } from "@/app/actions/procurement";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function PoPage({ params, searchParams }: { params: Promise<{ id: string; poid: string }>; searchParams: SearchParams }) {
  const { id, poid } = await params;
  const { error, notice } = await searchParams;
  const { user, project } = await requireProjectAccess(id);
  const po = await db.purchaseOrder.findFirst({
    where: { id: poid, projectId: id },
    include: {
      supplier: true,
      request: true,
      costCode: true,
      createdBy: true,
      approvedBy: true,
      lines: { include: { receipts: true } },
      receipts: { include: { createdBy: true, warehouse: true, lines: { include: { poLine: true } } }, orderBy: { date: "desc" } },
    },
  });
  if (!po) notFound();
  const showMoney = can(user.role, "money.view");
  const canReceive = can(user.role, "grn.create") && ["ISSUED", "PARTIAL"].includes(po.status);
  const warehouses = canReceive ? await db.warehouse.findMany({ where: { OR: [{ projectId: null }, { projectId: id }] }, orderBy: { code: "asc" } }) : [];

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl">
            أمر شراء PO-{po.number} · {po.supplier.name}
          </h2>
          <StatusBadge status={po.status} />
        </div>
        <div className="flex gap-2">
          {po.status === "PENDING_APPROVAL" && can(user.role, "po.approveHigh") && (
            <form action={approvePo.bind(null, id, poid)}>
              <button className="btn">اعتماد وإصدار</button>
            </form>
          )}
          {["PENDING_APPROVAL", "ISSUED"].includes(po.status) && po.receipts.length === 0 && can(user.role, "po.manage") && (
            <form action={cancelPo.bind(null, id, poid)}>
              <button className="btn-secondary">إلغاء</button>
            </form>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500">
        {project.name} · من طلب{" "}
        <Link href={`/projects/${id}/procurement/pr/${po.requestId}`} className="num text-brand-700 hover:underline">
          PR-{po.request.number}
        </Link>{" "}
        · أصدره {po.createdBy.name}
        {po.approvedBy && ` · اعتمده ${po.approvedBy.name}`}
        {po.costCode && ` · ${po.costCode.code} ${po.costCode.name}`}
      </p>

      <form action={receiveGoods.bind(null, id, poid)} className="card space-y-4 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>الوصف</th>
              <th>الوحدة</th>
              <th>المطلوب</th>
              {showMoney && <th>سعر الوحدة</th>}
              {showMoney && <th>الإجمالي</th>}
              <th>المستلم</th>
              {canReceive && <th>استلام الآن</th>}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => {
              const got = l.receipts.reduce((s, r) => s + r.quantity, 0);
              return (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td>{l.unit}</td>
                  <td className="num">{fmtQty(l.quantity)}</td>
                  {showMoney && <td className="num">{fmtMoney(l.unitPrice)}</td>}
                  {showMoney && <td className="num">{fmtMoney(l.quantity * l.unitPrice)}</td>}
                  <td className={`num ${got >= l.quantity ? "text-emerald-700" : ""}`}>{fmtQty(got)}</td>
                  {canReceive && (
                    <td className="w-32">
                      <input name={`rcv_${l.id}`} type="number" min="0" step="0.001" max={l.quantity - got} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {showMoney && (
            <tfoot>
              <tr className="bg-slate-50 font-bold">
                <td colSpan={4}>إجمالي أمر الشراء</td>
                <td className="num">{fmtMoney(po.total)}</td>
                <td colSpan={canReceive ? 2 : 1} />
              </tr>
            </tfoot>
          )}
        </table>
        {canReceive && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label>تاريخ الاستلام</label>
              <input name="date" type="date" defaultValue={todayStr()} />
            </div>
            <div>
              <label>رقم إذن التسليم</label>
              <input name="deliveryNote" />
            </div>
            <div>
              <label>وجهة المواد</label>
              <select name="warehouseId" defaultValue="" className="w-auto">
                <option value="">استهلاك مباشر في المشروع</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    إدخال لـ {w.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn">تسجيل الاستلام</button>
          </div>
        )}
      </form>

      {po.receipts.length > 0 && (
        <div className="card">
          <h2 className="mb-3">سجل الاستلام</h2>
          <ul className="space-y-2 text-sm">
            {po.receipts.map((r) => (
              <li key={r.id}>
                <span className="num font-semibold">{fmtDate(r.date)}</span> · {r.createdBy.name}
                {r.deliveryNote && ` · إذن ${r.deliveryNote}`}
                {r.warehouse && ` · إلى ${r.warehouse.name}`}:{" "}
                {r.lines.map((l) => `${l.poLine.description} ${fmtQty(l.quantity)} ${l.poLine.unit}`).join("، ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
