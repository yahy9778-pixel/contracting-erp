import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { billableQuantities } from "@/lib/ipc-service";
import { fmtDate, fmtQty, isOverdue, todayStr } from "@/lib/format";
import { closeNcr, createIr, createNcr, recordIr } from "@/app/actions/quality";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function QualityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user, project } = await requireProjectAccess(id);
  const [items, irs, ncrs, q] = await Promise.all([
    db.boqItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
    db.inspectionRequest.findMany({ where: { projectId: id }, include: { boqItem: true, createdBy: true }, orderBy: { number: "desc" } }),
    db.ncr.findMany({ where: { projectId: id }, include: { boqItem: true }, orderBy: [{ status: "desc" }, { number: "desc" }] }),
    billableQuantities(id),
  ]);
  const canRecord = can(user.role, "ir.record");
  const canNcr = can(user.role, "ncr.manage");
  // البنود التي نُفذت ولم تُستلم بالكامل: هي ما يؤخر المستخلص
  const gaps = items
    .map((i) => ({ i, reported: q.reported.get(i.id) ?? 0, inspected: q.inspected.get(i.id) ?? 0 }))
    .filter((g) => g.reported - g.inspected > 1e-9);

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />

      <section className="card">
        <h2>منفذ ولم يُستلم من الاستشاري</h2>
        <p className="mb-3 text-sm text-slate-500">
          {project.requireInspection
            ? "هذه الكميات لن تدخل المستخلص حتى يعتمد الاستشاري طلب استلامها."
            : "المشروع لا يشترط الاستلام قبل المستخلص، لكن المتابعة مفيدة."}
        </p>
        {gaps.length === 0 ? (
          <p className="text-sm text-emerald-700">كل الكميات المنفذة المعتمدة مستلمة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>البند</th>
                  <th>الوصف</th>
                  <th>منفذ معتمد</th>
                  <th>مستلم</th>
                  <th>بانتظار الاستلام</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map(({ i, reported, inspected }) => (
                  <tr key={i.id}>
                    <td className="num">{i.itemNo}</td>
                    <td>{i.description}</td>
                    <td className="num">{fmtQty(reported)}</td>
                    <td className="num">{fmtQty(inspected)}</td>
                    <td className="num font-semibold text-amber-700">
                      {fmtQty(reported - inspected)} {i.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2>طلبات الاستلام (IR)</h2>
        {can(user.role, "ir.create") && (
          <form action={createIr.bind(null, id)} className="card grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label>البند</label>
              <select name="boqItemId" required>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemNo} · {i.description} ({i.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>الموقع / المحور</label>
              <input name="location" required />
            </div>
            <div>
              <label>الكمية</label>
              <input name="quantity" type="number" min="0" step="0.001" required />
            </div>
            <div>
              <label>تاريخ الاستلام</label>
              <input name="inspectionDate" type="date" defaultValue={todayStr()} required />
            </div>
            <div className="md:col-span-5">
              <button className="btn">تسجيل طلب استلام</button>
            </div>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>البند</th>
                <th>الموقع</th>
                <th>الكمية</th>
                <th>التاريخ</th>
                <th>الحالة</th>
                <th>ملاحظات الاستشاري / التسجيل</th>
              </tr>
            </thead>
            <tbody>
              {irs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500">
                    لا توجد طلبات استلام بعد.
                  </td>
                </tr>
              )}
              {irs.map((ir) => (
                <tr key={ir.id}>
                  <td className="num">IR-{ir.number}</td>
                  <td>
                    <span className="num">{ir.boqItem.itemNo}</span> {ir.boqItem.description}
                  </td>
                  <td>{ir.location}</td>
                  <td className="num">
                    {fmtQty(ir.quantity)} {ir.boqItem.unit}
                  </td>
                  <td className="num">{fmtDate(ir.inspectionDate)}</td>
                  <td>
                    <StatusBadge status={ir.status} />
                  </td>
                  <td className="min-w-72">
                    {ir.status === "OPEN" && canRecord ? (
                      <form action={recordIr.bind(null, id, ir.id)} className="flex flex-wrap gap-2">
                        <select name="decision" required defaultValue="" className="w-auto">
                          <option value="" disabled>
                            النتيجة
                          </option>
                          <option value="APPROVED">معتمد</option>
                          <option value="APPROVED_WITH_COMMENTS">معتمد بملاحظات</option>
                          <option value="REJECTED">مرفوض</option>
                        </select>
                        <input name="comment" placeholder="ملاحظات الاستشاري" className="flex-1" />
                        <button className="btn-secondary">حفظ</button>
                      </form>
                    ) : (
                      <span className="text-sm">{ir.comment ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2>تقارير عدم المطابقة (NCR)</h2>
        {canNcr && (
          <form action={createNcr.bind(null, id)} className="card grid gap-3 md:grid-cols-4">
            <div>
              <label>المصدر</label>
              <select name="source">
                <option value="CONSULTANT">الاستشاري</option>
                <option value="INTERNAL">داخلي (جودة الشركة)</option>
              </select>
            </div>
            <div>
              <label>البند (اختياري)</label>
              <select name="boqItemId" defaultValue="">
                <option value="">—</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemNo} · {i.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>الموقع</label>
              <input name="location" />
            </div>
            <div>
              <label>موعد الإغلاق المطلوب</label>
              <input name="dueDate" type="date" />
            </div>
            <div className="md:col-span-4">
              <label>الوصف</label>
              <textarea name="description" rows={2} required />
            </div>
            <div className="md:col-span-4">
              <button className="btn">تسجيل NCR</button>
            </div>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الحالة</th>
                <th>المصدر</th>
                <th>الوصف</th>
                <th>موعد الإغلاق</th>
                <th>الإجراء التصحيحي</th>
              </tr>
            </thead>
            <tbody>
              {ncrs.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    لا توجد تقارير عدم مطابقة.
                  </td>
                </tr>
              )}
              {ncrs.map((n) => (
                <tr key={n.id}>
                  <td className="num">NCR-{n.number}</td>
                  <td>
                    <StatusBadge status={n.status} />
                  </td>
                  <td>{n.source === "CONSULTANT" ? "الاستشاري" : "داخلي"}</td>
                  <td>
                    {n.boqItem && <span className="num text-xs text-slate-500">{n.boqItem.itemNo} · </span>}
                    {n.description}
                    {n.location && <span className="text-xs text-slate-500"> ({n.location})</span>}
                  </td>
                  <td className={`num ${n.status === "OPEN" && isOverdue(n.dueDate) ? "font-semibold text-red-700" : ""}`}>{fmtDate(n.dueDate)}</td>
                  <td className="min-w-64">
                    {n.status === "OPEN" && canNcr ? (
                      <form action={closeNcr.bind(null, id, n.id)} className="flex gap-2">
                        <input name="correctiveAction" placeholder="ما الذي تم إصلاحه؟" required />
                        <button className="btn-secondary whitespace-nowrap">إغلاق</button>
                      </form>
                    ) : (
                      <span className="text-sm">{n.correctiveAction ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
