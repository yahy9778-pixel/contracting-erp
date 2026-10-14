import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { executedQuantities } from "@/lib/ipc-service";
import { fmtMoney, fmtPct, fmtQty } from "@/lib/format";
import { addBoqItem, deleteBoqItem, importBoq } from "@/app/actions/boq";
import { Empty, Flash } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function BoqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const showMoney = can(user.role, "money.view");
  const canEdit = can(user.role, "boq.edit");
  const [items, executed, costCodes] = await Promise.all([
    db.boqItem.findMany({ where: { projectId: id }, include: { costCode: true }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
    executedQuantities(id),
    db.costCode.findMany({ orderBy: { code: "asc" } }),
  ]);
  const total = items.reduce((s, i) => s + i.quantity * i.rate, 0);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      {items.length === 0 ? (
        <Empty>لا توجد بنود في جدول الكميات بعد.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>البند</th>
                <th>الوصف</th>
                <th>الوحدة</th>
                <th>الكمية التعاقدية</th>
                {showMoney && <th>سعر الوحدة</th>}
                {showMoney && <th>الإجمالي</th>}
                <th>المنفذ المعتمد</th>
                <th>الإنجاز</th>
                <th>رمز التكلفة</th>
                {canEdit && <th className="no-print" />}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const done = executed.get(i.id) ?? 0;
                const pct = i.quantity > 0 ? done / i.quantity : 0;
                return (
                  <tr key={i.id}>
                    <td className="num font-semibold">{i.itemNo}</td>
                    <td className="min-w-64">{i.description}</td>
                    <td>{i.unit}</td>
                    <td className="num">{fmtQty(i.quantity)}</td>
                    {showMoney && <td className="num">{fmtMoney(i.rate)}</td>}
                    {showMoney && <td className="num">{fmtMoney(i.quantity * i.rate)}</td>}
                    <td className="num">{fmtQty(done)}</td>
                    <td className={`num ${pct > 1 ? "font-semibold text-red-700" : ""}`}>{fmtPct(pct)}</td>
                    <td className="text-xs">{i.costCode ? `${i.costCode.code} ${i.costCode.name}` : "—"}</td>
                    {canEdit && (
                      <td className="no-print">
                        <form action={deleteBoqItem.bind(null, id, i.id)}>
                          <button className="text-xs text-red-600 hover:underline">حذف</button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {showMoney && (
              <tfoot>
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={5}>إجمالي جدول الكميات</td>
                  <td className="num">{fmtMoney(total)}</td>
                  <td colSpan={canEdit ? 4 : 3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {canEdit && (
        <div className="grid gap-6 lg:grid-cols-2 no-print">
          <form action={addBoqItem.bind(null, id)} className="card grid grid-cols-2 gap-3">
            <h2 className="col-span-2">إضافة بند</h2>
            <div>
              <label>رقم البند</label>
              <input name="itemNo" required dir="ltr" />
            </div>
            <div>
              <label>الوحدة</label>
              <input name="unit" required placeholder="م3" />
            </div>
            <div className="col-span-2">
              <label>الوصف</label>
              <input name="description" required />
            </div>
            <div>
              <label>الكمية</label>
              <input name="quantity" type="number" step="0.001" min="0" required />
            </div>
            <div>
              <label>سعر الوحدة</label>
              <input name="rate" type="number" step="0.01" min="0" required />
            </div>
            <div className="col-span-2">
              <label>رمز التكلفة</label>
              <select name="costCodeId" defaultValue="">
                <option value="">— بدون —</option>
                {costCodes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <button className="btn">إضافة</button>
            </div>
          </form>

          <form action={importBoq.bind(null, id)} className="card space-y-3">
            <h2>استيراد من Excel</h2>
            <p className="text-sm text-slate-500">
              انسخ الأعمدة من Excel بهذا الترتيب والصقها هنا: رقم البند، الوصف، الوحدة، الكمية، سعر الوحدة، رمز التكلفة (اختياري مثل D3).
            </p>
            <textarea name="text" rows={8} required dir="auto" className="font-mono text-xs" />
            <button className="btn">استيراد البنود</button>
          </form>
        </div>
      )}
    </div>
  );
}
