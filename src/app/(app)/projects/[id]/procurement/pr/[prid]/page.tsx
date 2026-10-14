import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can, PO_APPROVAL_LIMIT } from "@/lib/permissions";
import { compareQuotes } from "@/lib/procurement";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/format";
import { addQuotation, createPoFromQuote, reviewPr, submitPr } from "@/app/actions/procurement";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function PrPage({ params, searchParams }: { params: Promise<{ id: string; prid: string }>; searchParams: SearchParams }) {
  const { id, prid } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const pr = await db.purchaseRequest.findFirst({
    where: { id: prid, projectId: id },
    include: {
      lines: true,
      costCode: true,
      submittal: true,
      createdBy: true,
      approvedBy: true,
      quotations: { include: { supplier: true, lines: true }, orderBy: { createdAt: "asc" } },
      orders: true,
    },
  });
  if (!pr) notFound();
  const showMoney = can(user.role, "money.view");
  const canBuy = can(user.role, "po.manage");
  const { totals, lowest } = compareQuotes(pr.lines, pr.quotations);
  const totalOf = new Map(totals.map((t) => [t.id, t]));

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl">
            PR-{pr.number} · {pr.title}
          </h2>
          <StatusBadge status={pr.status} />
        </div>
        <div className="flex gap-2">
          {pr.status === "DRAFT" && can(user.role, "pr.create") && (
            <form action={submitPr.bind(null, id, prid)}>
              <button className="btn">رفع للاعتماد</button>
            </form>
          )}
          {pr.status === "SUBMITTED" && can(user.role, "pr.approve") && (
            <>
              <form action={reviewPr.bind(null, id, prid, "APPROVED")}>
                <button className="btn">اعتماد</button>
              </form>
              <form action={reviewPr.bind(null, id, prid, "REJECTED")}>
                <button className="btn-danger">رفض</button>
              </form>
            </>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500">
        طلبه {pr.createdBy.name}
        {pr.approvedBy && ` · راجعه ${pr.approvedBy.name}`} · مطلوب بتاريخ <span className="num">{fmtDate(pr.requiredDate)}</span>
        {pr.costCode && ` · ${pr.costCode.code} ${pr.costCode.name}`}
        {pr.submittal && ` · مرتبط بـ SUB-${pr.submittal.number} (${pr.submittal.status})`}
      </p>
      {pr.orders.length > 0 && (
        <p className="text-sm">
          أوامر الشراء:{" "}
          {pr.orders.map((o) => (
            <Link key={o.id} href={`/projects/${id}/procurement/po/${o.id}`} className="num me-2 text-brand-700 hover:underline">
              PO-{o.number}
            </Link>
          ))}
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الوصف</th>
              <th>الوحدة</th>
              <th>الكمية</th>
              {showMoney &&
                pr.quotations.map((q) => (
                  <th key={q.id} className={q.id === lowest ? "bg-emerald-100" : ""}>
                    {q.supplier.name}
                    {q.deliveryDays != null && <div className="text-xs font-normal">توريد خلال {q.deliveryDays} يوم</div>}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {pr.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{l.unit}</td>
                <td className="num">{fmtQty(l.quantity)}</td>
                {showMoney &&
                  pr.quotations.map((q) => {
                    const price = q.lines.find((x) => x.prLineId === l.id)?.unitPrice;
                    return (
                      <td key={q.id} className="num">
                        {price != null ? fmtMoney(price) : "—"}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
          {showMoney && pr.quotations.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-bold">
                <td colSpan={3}>الإجمالي</td>
                {pr.quotations.map((q) => {
                  const t = totalOf.get(q.id)!;
                  return (
                    <td key={q.id} className={`num ${q.id === lowest ? "text-emerald-700" : ""}`}>
                      {fmtMoney(t.total)}
                      {!t.complete && <div className="text-xs font-normal text-amber-700">عرض ناقص</div>}
                      {q.id === lowest && <div className="text-xs font-normal">الأقل سعرا</div>}
                    </td>
                  );
                })}
              </tr>
              {pr.status === "APPROVED" && canBuy && (
                <tr>
                  <td colSpan={3} className="text-sm text-slate-500">
                    حد صلاحية المشتريات: <span className="num">{fmtMoney(PO_APPROVAL_LIMIT)}</span>، وما فوقه يعتمده المالك.
                  </td>
                  {pr.quotations.map((q) => (
                    <td key={q.id}>
                      {totalOf.get(q.id)!.complete && (
                        <form action={createPoFromQuote.bind(null, id, prid, q.id)} className="space-y-2">
                          {q.id !== lowest && <input name="justification" placeholder="سبب اختيار عرض أعلى" />}
                          <button className="btn-secondary w-full">إصدار أمر شراء</button>
                        </form>
                      )}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>

      {pr.status === "APPROVED" && canBuy && (
        <form action={addQuotation.bind(null, id, prid)} className="card space-y-3">
          <h2>تسجيل عرض سعر</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label>المورد</label>
              <input name="supplier" required />
            </div>
            <div>
              <label>تصنيف المورد</label>
              <select name="category" defaultValue="E1">
                <option value="E1">E1 مواد خام</option>
                <option value="E2">E2 أدوات</option>
                <option value="E3">E3 معدات</option>
                <option value="E4">E4 إكسسوارات</option>
                <option value="F1">F1 مواد شدة</option>
                <option value="F2">F2 نقل أفقي</option>
                <option value="F3">F3 نقل رأسي</option>
              </select>
            </div>
            <div>
              <label>مدة التوريد (يوم)</label>
              <input name="deliveryDays" type="number" min="0" />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {pr.lines.map((l) => (
              <div key={l.id}>
                <label>
                  سعر الوحدة: {l.description} ({fmtQty(l.quantity)} {l.unit})
                </label>
                <input name={`price_${l.id}`} type="number" min="0" step="0.01" />
              </div>
            ))}
          </div>
          <div>
            <label>ملاحظات</label>
            <input name="notes" />
          </div>
          <button className="btn">حفظ العرض</button>
        </form>
      )}
    </div>
  );
}
