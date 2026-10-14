import Link from "next/link";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney, isOverdue } from "@/lib/format";
import { createPr } from "@/app/actions/procurement";
import { Flash, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const ROWS = Array.from({ length: 8 }, (_, i) => i);

export default async function ProcurementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const showMoney = can(user.role, "money.view");
  const [prs, pos, costCodes, submittals, boq] = await Promise.all([
    db.purchaseRequest.findMany({ where: { projectId: id }, include: { createdBy: true, costCode: true }, orderBy: { number: "desc" } }),
    db.purchaseOrder.findMany({ where: { projectId: id }, include: { supplier: true, costCode: true }, orderBy: { number: "desc" } }),
    db.costCode.findMany({ orderBy: { code: "asc" } }),
    db.submittal.findMany({ where: { projectId: id, type: "MATERIAL" }, orderBy: [{ number: "asc" }, { revision: "desc" }] }),
    db.boqItem.findMany({ where: { projectId: id }, include: { costCode: true } }),
  ]);

  // الالتزامات (أوامر الشراء) لكل رمز تكلفة مقابل قيمة بنوده في العقد
  const committed = new Map<string, number>();
  for (const po of pos) if (po.status !== "CANCELLED") committed.set(po.costCode?.code ?? "—", (committed.get(po.costCode?.code ?? "—") ?? 0) + po.total);
  const contractByCode = new Map<string, number>();
  for (const b of boq) contractByCode.set(b.costCode?.code ?? "—", (contractByCode.get(b.costCode?.code ?? "—") ?? 0) + b.quantity * b.rate);
  const latestSub = new Map<number, (typeof submittals)[number]>();
  for (const s of submittals) if (!latestSub.has(s.number)) latestSub.set(s.number, s);

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />

      {showMoney && committed.size > 0 && (
        <section className="card">
          <h2 className="mb-3">الالتزامات حسب رمز التكلفة</h2>
          <table>
            <thead>
              <tr>
                <th>رمز التكلفة</th>
                <th>قيمة البنود في العقد (بيع)</th>
                <th>أوامر الشراء الصادرة (تكلفة)</th>
                <th>النسبة</th>
              </tr>
            </thead>
            <tbody>
              {[...committed.entries()].map(([code, value]) => {
                const sell = contractByCode.get(code) ?? 0;
                const ratio = sell > 0 ? value / sell : 0;
                return (
                  <tr key={code}>
                    <td className="num">{code}</td>
                    <td className="num">{fmtMoney(sell)}</td>
                    <td className="num">{fmtMoney(value)}</td>
                    <td className={`num ${ratio > 0.85 ? "font-semibold text-red-700" : ""}`}>{sell ? `${(ratio * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-4">
        <h2>طلبات الشراء</h2>
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>العنوان</th>
                <th>الحالة</th>
                <th>مطلوب بتاريخ</th>
                <th>رمز التكلفة</th>
                <th>بواسطة</th>
              </tr>
            </thead>
            <tbody>
              {prs.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    لا توجد طلبات شراء.
                  </td>
                </tr>
              )}
              {prs.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${id}/procurement/pr/${p.id}`} className="num font-semibold text-brand-700 hover:underline">
                      PR-{p.number}
                    </Link>
                  </td>
                  <td>{p.title}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className={`num ${["DRAFT", "SUBMITTED", "APPROVED"].includes(p.status) && isOverdue(p.requiredDate) ? "font-semibold text-red-700" : ""}`}>
                    {fmtDate(p.requiredDate)}
                  </td>
                  <td className="num">{p.costCode?.code ?? "—"}</td>
                  <td>{p.createdBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {can(user.role, "pr.create") && (
          <form action={createPr.bind(null, id)} className="card space-y-4">
            <h2>طلب شراء جديد</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <label>العنوان</label>
                <input name="title" required placeholder="حديد تسليح للأسقف - الدور الأول" />
              </div>
              <div>
                <label>مطلوب في الموقع بتاريخ</label>
                <input name="requiredDate" type="date" />
              </div>
              <div>
                <label>رمز التكلفة</label>
                <select name="costCodeId" defaultValue="">
                  <option value="">—</option>
                  {costCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <label>اعتماد المادة (Submittal) إن وجد</label>
                <select name="submittalId" defaultValue="">
                  <option value="">—</option>
                  {[...latestSub.values()].map((s) => (
                    <option key={s.id} value={s.id}>
                      SUB-{s.number} Rev.{s.revision} · {s.title} ({s.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2">
              <span className="col-span-4 text-xs text-slate-500">الوصف</span>
              <span className="text-xs text-slate-500">الوحدة</span>
              <span className="text-xs text-slate-500">الكمية</span>
              {ROWS.map((i) => (
                <div key={i} className="contents">
                  <input className="col-span-4" name={`desc_${i}`} />
                  <input name={`unit_${i}`} placeholder="طن" />
                  <input name={`qty_${i}`} type="number" min="0" step="0.001" />
                </div>
              ))}
            </div>
            <button className="btn">حفظ كمسودة</button>
          </form>
        )}
      </section>

      <section className="space-y-4">
        <h2>أوامر الشراء</h2>
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>المورد</th>
                <th>الحالة</th>
                {showMoney && <th>القيمة</th>}
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {pos.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500">
                    لا توجد أوامر شراء.
                  </td>
                </tr>
              )}
              {pos.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/projects/${id}/procurement/po/${p.id}`} className="num font-semibold text-brand-700 hover:underline">
                      PO-{p.number}
                    </Link>
                  </td>
                  <td>{p.supplier.name}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  {showMoney && <td className="num">{fmtMoney(p.total)}</td>}
                  <td className="num">{fmtDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
