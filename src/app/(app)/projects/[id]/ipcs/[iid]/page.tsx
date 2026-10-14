import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format";
import { deleteIpc, moveIpc } from "@/app/actions/ipcs";
import { Flash, StatusBadge } from "@/components/ui";
import { PrintButton } from "./print-button";
import { CashAccountSelect } from "@/components/cash-select";
import type { SearchParams } from "@/lib/flash";

export default async function IpcPage({ params, searchParams }: { params: Promise<{ id: string; iid: string }>; searchParams: SearchParams }) {
  const { id, iid } = await params;
  const { error, notice } = await searchParams;
  const { user, project } = await requireProjectAccess(id, "money.view", { page: true });
  const ipc = await db.paymentCertificate.findFirst({
    where: { id: iid, projectId: id },
    include: { lines: { include: { boqItem: true }, orderBy: { boqItem: { sortOrder: "asc" } } } },
  });
  if (!ipc) notFound();

  const summary: [string, number, boolean?][] = [
    ["قيمة الأعمال المنفذة حتى تاريخه", ipc.grossCumulative],
    ["يخصم: قيمة المستخلصات السابقة", -ipc.previousGross],
    ["قيمة أعمال هذه الفترة", ipc.currentGross, true],
    [`يخصم: المحتجز (${project.retentionPct}%)`, -ipc.retention],
    ["يخصم: استرداد الدفعة المقدمة", -ipc.advanceRecovery],
    [`يضاف: ضريبة القيمة المضافة (${project.vatPct}%)`, ipc.vat],
    ["الصافي المستحق", ipc.netPayable, true],
  ];

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <StatusBadge status={ipc.status} />
        <div className="flex flex-wrap items-end gap-2">
          <PrintButton />
          {ipc.status === "DRAFT" && can(user.role, "ipc.submit") && (
            <>
              <form action={moveIpc.bind(null, id, iid, "SUBMITTED")}>
                <button className="btn">تسجيل الرفع للاستشاري</button>
              </form>
              <form action={deleteIpc.bind(null, id, iid)}>
                <button className="btn-secondary">حذف المسودة</button>
              </form>
            </>
          )}
          {ipc.status === "SUBMITTED" && can(user.role, "ipc.approve") && (
            <form action={moveIpc.bind(null, id, iid, "APPROVED")} className="flex items-end gap-2">
              <div>
                <label>المبلغ المعتمد من الاستشاري</label>
                <input name="approvedAmount" type="number" step="0.01" defaultValue={ipc.netPayable} />
              </div>
              <button className="btn">تسجيل الاعتماد</button>
            </form>
          )}
          {ipc.status === "APPROVED" && can(user.role, "ipc.markPaid") && (
            <form action={moveIpc.bind(null, id, iid, "PAID")} className="flex items-end gap-2">
              <div>
                <label>يُودع في</label>
                <CashAccountSelect />
              </div>
              <button className="btn">تسجيل التحصيل</button>
            </form>
          )}
        </div>
      </div>

      <div className="card space-y-6">
        <div className="flex flex-wrap justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-xl">مستخلص جاري رقم {ipc.number}</h2>
            <p className="text-sm text-slate-600">
              {project.name} ({project.code})
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">المالك</dt>
            <dd>{project.client.name}</dd>
            <dt className="text-slate-500">الاستشاري</dt>
            <dd>{project.consultant?.name ?? "—"}</dd>
            <dt className="text-slate-500">حتى تاريخ</dt>
            <dd className="num">{fmtDate(ipc.periodTo)}</dd>
          </dl>
        </div>

        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>البند</th>
                <th>الوصف</th>
                <th>الوحدة</th>
                <th>سعر الوحدة</th>
                <th>الكمية السابقة</th>
                <th>كمية الفترة</th>
                <th>الكمية التراكمية</th>
                <th>القيمة التراكمية</th>
              </tr>
            </thead>
            <tbody>
              {ipc.lines.map((l) => (
                <tr key={l.id}>
                  <td className="num">{l.boqItem.itemNo}</td>
                  <td>{l.boqItem.description}</td>
                  <td>{l.boqItem.unit}</td>
                  <td className="num">{fmtMoney(l.rate)}</td>
                  <td className="num">{fmtQty(l.previousQty)}</td>
                  <td className="num">{fmtQty(l.currentQty)}</td>
                  <td className={`num ${l.cumulativeQty > l.boqItem.quantity ? "font-semibold text-red-700" : ""}`}>{fmtQty(l.cumulativeQty)}</td>
                  <td className="num">{fmtMoney(l.cumulativeQty * l.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <table className="ms-auto max-w-lg">
          <tbody>
            {summary.map(([label, value, strong]) => (
              <tr key={label} className={strong ? "bg-slate-50 font-bold" : ""}>
                <td>{label}</td>
                <td className="num text-end">{fmtMoney(value || 0)}</td>
              </tr>
            ))}
            {ipc.approvedAmount != null && (
              <tr className="font-bold text-emerald-800">
                <td>المعتمد من الاستشاري</td>
                <td className="num text-end">{fmtMoney(ipc.approvedAmount)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="grid grid-cols-3 gap-6 pt-10 text-center text-sm text-slate-600">
          <div className="border-t border-slate-300 pt-2">إعداد: قسم العقود</div>
          <div className="border-t border-slate-300 pt-2">مراجعة: الاستشاري</div>
          <div className="border-t border-slate-300 pt-2">اعتماد: المالك</div>
        </div>
      </div>
    </div>
  );
}
