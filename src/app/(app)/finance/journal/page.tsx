import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtMoney, todayStr } from "@/lib/format";
import { JOURNAL_LINES } from "@/lib/ledger";
import { createJournal, reverseJournal } from "@/app/actions/finance";
import { Flash } from "@/components/ui";

type Search = Promise<{ error?: string; notice?: string; project?: string }>;

export default async function JournalPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePagePermission("finance.view");
  const { error, notice, project } = await searchParams;
  const [accounts, projects, entries] = await Promise.all([
    db.account.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.project.findMany({ orderBy: { code: "asc" } }),
    db.journalEntry.findMany({
      where: project ? { lines: { some: { projectId: project } } } : {},
      include: { lines: { include: { account: true, project: true, party: true, costCode: true } } },
      orderBy: { number: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />

      {can(user.role, "finance.post") && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">قيد يومية يدوي</summary>
          <p className="mt-2 text-sm text-slate-500">
            للتسويات وما لا يأتي من دورة مستندية: رأس المال، الرواتب، الإفراج عن المحتجزات، المصاريف الإدارية. القيود الآلية تُرحَّل وحدها.
          </p>
          <form action={createJournal} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label>التاريخ</label>
                <input name="date" type="date" defaultValue={todayStr()} required />
              </div>
              <div className="md:col-span-3">
                <label>البيان</label>
                <input name="description" required />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>مدين</th>
                    <th>دائن</th>
                    <th>المشروع</th>
                    <th>ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: JOURNAL_LINES }, (_, i) => (
                    <tr key={i}>
                      <td className="min-w-56">
                        <select name={`account_${i}`} defaultValue="">
                          <option value="">—</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.code}>
                              {a.code} · {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input name={`debit_${i}`} type="number" min="0" step="0.01" />
                      </td>
                      <td>
                        <input name={`credit_${i}`} type="number" min="0" step="0.01" />
                      </td>
                      <td>
                        <select name={`project_${i}`} defaultValue="">
                          <option value="">عام (الشركة)</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input name={`memo_${i}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn">ترحيل القيد</button>
          </form>
        </details>
      )}

      <form className="flex items-end gap-2">
        <div>
          <label>المشروع</label>
          <select name="project" defaultValue={project ?? ""} className="w-auto">
            <option value="">كل القيود</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-secondary">عرض</button>
      </form>

      <div className="space-y-3">
        {entries.length === 0 && <p className="text-slate-500">لا توجد قيود بعد.</p>}
        {entries.map((e) => (
          <div key={e.id} className={`card p-0 ${e.reversedBy ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <span className="num font-bold">#{e.number}</span> · <span className="num">{fmtDate(e.date)}</span> · {e.description}
                <span className={`badge ms-2 ${e.kind === "MANUAL" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                  {e.kind === "MANUAL" ? "يدوي" : "آلي"}
                </span>
                {e.reversedBy && <span className="badge ms-2 bg-red-100 text-red-700">معكوس</span>}
              </div>
              {e.kind === "MANUAL" && !e.reversedBy && !e.sourceKey && can(user.role, "finance.post") && (
                <form action={reverseJournal.bind(null, e.id)}>
                  <button className="text-xs text-red-600 hover:underline">عكس القيد</button>
                </form>
              )}
            </div>
            <table>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id}>
                    <td className={`w-2/5 ${l.credit ? "ps-10" : ""}`}>
                      <span className="num">{l.account.code}</span> {l.account.name}
                    </td>
                    <td className="text-xs text-slate-500">
                      {[l.project?.code, l.party?.name, l.costCode?.code, l.memo].filter(Boolean).join(" · ")}
                    </td>
                    <td className="num w-32">{l.debit ? fmtMoney(l.debit) : ""}</td>
                    <td className="num w-32">{l.credit ? fmtMoney(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
