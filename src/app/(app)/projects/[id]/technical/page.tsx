import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, isOverdue } from "@/lib/format";
import { answerRfi, createRfi, createSubmittal, respondSubmittal, reviseSubmittal, submitSubmittal } from "@/app/actions/technical";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const TYPE_LABELS: Record<string, string> = {
  MATERIAL: "اعتماد مادة",
  SHOP_DRAWING: "مخططات تنفيذية",
  METHOD_STATEMENT: "طريقة تنفيذ",
};

export default async function TechnicalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const canManage = can(user.role, "tech.manage");
  const [items, submittals, rfis] = await Promise.all([
    db.boqItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }, { itemNo: "asc" }] }),
    db.submittal.findMany({ where: { projectId: id }, include: { boqItem: true }, orderBy: [{ number: "desc" }, { revision: "desc" }] }),
    db.rfi.findMany({ where: { projectId: id }, orderBy: { number: "desc" } }),
  ]);
  const latestRev = new Map<number, number>();
  for (const s of submittals) latestRev.set(s.number, Math.max(latestRev.get(s.number) ?? 0, s.revision));

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />

      <section className="space-y-4">
        <h2>الـ Submittals: المواد والمخططات وطرق التنفيذ</h2>
        {canManage && (
          <form action={createSubmittal.bind(null, id)} className="card grid gap-3 md:grid-cols-4">
            <div>
              <label>النوع</label>
              <select name="type">
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label>العنوان</label>
              <input name="title" required placeholder="حديد تسليح 16 مم من المصنع الوطني" />
            </div>
            <div>
              <label>البند المرتبط</label>
              <select name="boqItemId" defaultValue="">
                <option value="">—</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemNo} · {i.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4">
              <button className="btn">إنشاء</button>
            </div>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>النوع</th>
                <th>العنوان</th>
                <th>الحالة</th>
                <th>موعد الرد</th>
                <th>ملاحظات</th>
                {canManage && <th>إجراء</th>}
              </tr>
            </thead>
            <tbody>
              {submittals.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500">
                    لا توجد Submittals بعد.
                  </td>
                </tr>
              )}
              {submittals.map((s) => {
                const isLatest = latestRev.get(s.number) === s.revision;
                const late = s.status === "SUBMITTED" && isOverdue(s.dueDate);
                return (
                  <tr key={s.id} className={isLatest ? "" : "text-slate-400"}>
                    <td className="num">
                      SUB-{s.number} Rev.{s.revision}
                    </td>
                    <td>{TYPE_LABELS[s.type]}</td>
                    <td>
                      {s.title}
                      {s.boqItem && <div className="num text-xs text-slate-500">{s.boqItem.itemNo}</div>}
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className={`num ${late ? "font-semibold text-red-700" : ""}`}>
                      {fmtDate(s.dueDate)}
                      {late && " (متأخر)"}
                    </td>
                    <td className="text-sm">{s.comment ?? "—"}</td>
                    {canManage && (
                      <td className="min-w-64">
                        {isLatest && s.status === "DRAFT" && (
                          <form action={submitSubmittal.bind(null, id, s.id)} className="flex gap-2">
                            <input name="dueDate" type="date" title="موعد رد الاستشاري (افتراضي 14 يوما)" />
                            <button className="btn-secondary whitespace-nowrap">رفع للاستشاري</button>
                          </form>
                        )}
                        {isLatest && s.status === "SUBMITTED" && (
                          <form action={respondSubmittal.bind(null, id, s.id)} className="flex gap-2">
                            <select name="code" required defaultValue="" className="w-auto">
                              <option value="" disabled>
                                الرد
                              </option>
                              <option value="A">A معتمد</option>
                              <option value="B">B معتمد بملاحظات</option>
                              <option value="C">C يعدل ويعاد</option>
                              <option value="D">D مرفوض</option>
                            </select>
                            <input name="comment" placeholder="ملاحظات" />
                            <button className="btn-secondary">حفظ</button>
                          </form>
                        )}
                        {isLatest && ["C", "D"].includes(s.status) && (
                          <form action={reviseSubmittal.bind(null, id, s.id)}>
                            <button className="btn-secondary">إصدار جديد</button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2>الاستفسارات الفنية (RFI)</h2>
        {canManage && (
          <form action={createRfi.bind(null, id)} className="card grid gap-3 md:grid-cols-4">
            <div className="md:col-span-3">
              <label>الموضوع</label>
              <input name="subject" required />
            </div>
            <div>
              <label>موعد الرد المطلوب</label>
              <input name="dueDate" type="date" />
            </div>
            <div className="md:col-span-4">
              <label>السؤال</label>
              <textarea name="question" rows={2} required />
            </div>
            <div className="md:col-span-4">
              <button className="btn">تسجيل RFI</button>
            </div>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الموضوع</th>
                <th>الحالة</th>
                <th>موعد الرد</th>
                <th>الرد</th>
              </tr>
            </thead>
            <tbody>
              {rfis.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500">
                    لا توجد استفسارات.
                  </td>
                </tr>
              )}
              {rfis.map((r) => {
                const late = r.status === "OPEN" && isOverdue(r.dueDate);
                return (
                  <tr key={r.id}>
                    <td className="num">RFI-{r.number}</td>
                    <td>
                      <div className="font-semibold">{r.subject}</div>
                      <div className="text-sm text-slate-600">{r.question}</div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={`num ${late ? "font-semibold text-red-700" : ""}`}>
                      {fmtDate(r.dueDate)}
                      {late && " (متأخر)"}
                    </td>
                    <td className="min-w-64">
                      {r.status === "OPEN" && canManage ? (
                        <form action={answerRfi.bind(null, id, r.id)} className="flex gap-2">
                          <input name="answer" placeholder="رد الاستشاري" required />
                          <button className="btn-secondary">حفظ</button>
                        </form>
                      ) : (
                        <span className="text-sm">{r.answer ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
