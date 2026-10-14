import { db } from "@/lib/db";
import { projectScope, requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney, fmtQty, todayStr } from "@/lib/format";
import { countStock, createItem, createWarehouse, issueStock, transferStock, updateItemMin } from "@/app/actions/stores";
import { Flash, PageHeader } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const MOVE_LABELS: Record<string, string> = { IN: "استلام", ISSUE: "صرف لمشروع", TRANSFER: "تحويل", ADJUST: "تسوية جرد" };

export default async function StoresPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("store.view");
  const { error, notice } = await searchParams;
  const [warehouses, items, sums, moves, projects, codes] = await Promise.all([
    db.warehouse.findMany({ include: { project: true }, orderBy: { code: "asc" } }),
    db.stockItem.findMany({ include: { costCode: true }, orderBy: { code: "asc" } }),
    db.stockMove.groupBy({ by: ["itemId", "warehouseId"], _sum: { quantity: true, value: true } }),
    db.stockMove.findMany({ include: { item: true, warehouse: true, project: true }, orderBy: [{ number: "desc" }], take: 40 }),
    db.project.findMany({ where: projectScope(user), orderBy: { code: "asc" } }),
    db.costCode.findMany({ orderBy: { code: "asc" } }),
  ]);
  const canManage = can(user.role, "store.manage");
  const qty = (itemId: string, whId?: string) =>
    sums.filter((s) => s.itemId === itemId && (!whId || s.warehouseId === whId)).reduce((t, s) => t + (s._sum.quantity ?? 0), 0);
  const val = (itemId: string) => sums.filter((s) => s.itemId === itemId).reduce((t, s) => t + (s._sum.value ?? 0), 0);
  const low = items.filter((i) => i.minQty > 0 && qty(i.id) < i.minQty);
  const totalValue = items.reduce((t, i) => t + val(i.id), 0);

  const ItemSelect = () => (
    <select name="itemId" required defaultValue="">
      <option value="" disabled>
        الصنف
      </option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.code} · {i.name} ({fmtQty(qty(i.id))} {i.unit})
        </option>
      ))}
    </select>
  );
  const WhSelect = ({ name, label }: { name: string; label: string }) => (
    <select name={name} required defaultValue="">
      <option value="" disabled>
        {label}
      </option>
      {warehouses.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-8">
      <PageHeader title="المستودعات" sub={`قيمة المخزون الحالية ${fmtMoney(totalValue)} بمتوسط التكلفة المرجح`} />
      <Flash error={error} notice={notice} />
      {low.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          أصناف تحت حد إعادة الطلب: {low.map((i) => `${i.name} (${fmtQty(qty(i.id))} من ${fmtQty(i.minQty)} ${i.unit})`).join("، ")}
        </div>
      )}

      <section className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الصنف</th>
              <th>الوحدة</th>
              {warehouses.map((w) => (
                <th key={w.id}>{w.name}</th>
              ))}
              <th>الإجمالي</th>
              <th>متوسط التكلفة</th>
              <th>القيمة</th>
              <th>حد إعادة الطلب</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6 + warehouses.length} className="text-center text-slate-500">
                  لا توجد أصناف بعد. تُنشأ تلقائيا عند استلام أمر شراء إلى مستودع.
                </td>
              </tr>
            )}
            {items.map((i) => {
              const total = qty(i.id);
              return (
                <tr key={i.id} className={i.minQty > 0 && total < i.minQty ? "bg-amber-50" : ""}>
                  <td>
                    <span className="num text-xs text-slate-500">{i.code}</span> {i.name}
                    {i.costCode && <div className="text-xs text-slate-500">{i.costCode.code} {i.costCode.name}</div>}
                  </td>
                  <td>{i.unit}</td>
                  {warehouses.map((w) => (
                    <td key={w.id} className="num">
                      {fmtQty(qty(i.id, w.id))}
                    </td>
                  ))}
                  <td className="num font-semibold">{fmtQty(total)}</td>
                  <td className="num">{total > 0 ? fmtMoney(val(i.id) / total) : "—"}</td>
                  <td className="num">{fmtMoney(val(i.id))}</td>
                  <td className="w-40">
                    {canManage ? (
                      <form action={updateItemMin.bind(null, i.id)} className="flex gap-1">
                        <input name="minQty" type="number" min="0" step="0.001" defaultValue={i.minQty} className="num" aria-label="حد إعادة الطلب" />
                        <button className="btn-secondary px-2 py-1">حفظ</button>
                      </form>
                    ) : (
                      <span className="num">{fmtQty(i.minQty)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={issueStock} className="card space-y-3">
            <h2>صرف مواد لمشروع</h2>
            <div className="grid grid-cols-2 gap-3">
              <WhSelect name="warehouseId" label="من مستودع" />
              <ItemSelect />
              <select name="projectId" required defaultValue="">
                <option value="" disabled>
                  للمشروع
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
              <select name="costCodeId" defaultValue="">
                <option value="">رمز تكلفة الصنف</option>
                {codes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
              <input name="quantity" type="number" min="0.001" step="0.001" placeholder="الكمية" required />
              <input name="date" type="date" defaultValue={todayStr()} />
              <input name="reference" placeholder="رقم طلب الصرف" className="col-span-2" />
            </div>
            <button className="btn">صرف</button>
          </form>

          <form action={transferStock} className="card space-y-3">
            <h2>تحويل بين المستودعات</h2>
            <div className="grid grid-cols-2 gap-3">
              <WhSelect name="fromId" label="من" />
              <WhSelect name="toId" label="إلى" />
              <ItemSelect />
              <input name="quantity" type="number" min="0.001" step="0.001" placeholder="الكمية" required />
              <input name="date" type="date" defaultValue={todayStr()} />
              <input name="reference" placeholder="رقم إذن التحويل" />
            </div>
            <button className="btn">تحويل</button>
          </form>

          <form action={countStock} className="card space-y-3">
            <h2>جرد فعلي ورصيد افتتاحي</h2>
            <p className="text-xs text-slate-500">أدخل الكمية الموجودة فعلا. الفرق عن الرصيد الدفتري يُسوّى بقيد فروقات جرد.</p>
            <div className="grid grid-cols-2 gap-3">
              <WhSelect name="warehouseId" label="المستودع" />
              <ItemSelect />
              <input name="counted" type="number" min="0" step="0.001" placeholder="الكمية الفعلية" required />
              <input name="unitCost" type="number" min="0" step="0.01" placeholder="تكلفة الوحدة (لصنف جديد فقط)" />
            </div>
            <button className="btn">تسجيل الجرد</button>
          </form>

          <div className="card space-y-4">
            <form action={createItem} className="space-y-3">
              <h2>صنف جديد</h2>
              <div className="grid grid-cols-2 gap-3">
                <input name="name" placeholder="اسم الصنف" required />
                <input name="unit" placeholder="الوحدة" required />
                <select name="costCodeId" defaultValue="">
                  <option value="">رمز التكلفة</option>
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
                <input name="minQty" type="number" min="0" step="0.001" placeholder="حد إعادة الطلب" />
              </div>
              <button className="btn-secondary">إضافة صنف</button>
            </form>
            <form action={createWarehouse} className="space-y-3 border-t border-slate-200 pt-4">
              <h2>مستودع جديد</h2>
              <div className="grid grid-cols-3 gap-3">
                <input name="code" placeholder="الرمز" required />
                <input name="name" placeholder="الاسم" required />
                <select name="projectId" defaultValue="">
                  <option value="">مركزي</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      موقع {p.code}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-secondary">إضافة مستودع</button>
            </form>
          </div>
        </div>
      )}

      <section className="card overflow-x-auto p-0">
        <h2 className="px-4 pt-4">آخر الحركات</h2>
        <table className="mt-2">
          <thead>
            <tr>
              <th>الرقم</th>
              <th>التاريخ</th>
              <th>النوع</th>
              <th>الصنف</th>
              <th>المستودع</th>
              <th>الكمية</th>
              <th>القيمة</th>
              <th>المشروع / ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {moves.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد حركات.
                </td>
              </tr>
            )}
            {moves.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.number}</td>
                <td className="num">{fmtDate(m.date)}</td>
                <td>{MOVE_LABELS[m.type] ?? m.type}</td>
                <td>{m.item.name}</td>
                <td>{m.warehouse.name}</td>
                <td className={`num ${m.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {fmtQty(m.quantity)} {m.item.unit}
                </td>
                <td className="num">{fmtMoney(m.value)}</td>
                <td className="text-sm">{[m.project?.code, m.reference, m.notes].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
