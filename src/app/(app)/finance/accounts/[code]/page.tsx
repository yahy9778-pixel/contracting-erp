import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { normalBalance } from "@/lib/ledger";

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ project?: string }> }) {
  await requirePagePermission("finance.view");
  const { code } = await params;
  const { project } = await searchParams;
  const account = await db.account.findUnique({ where: { code } });
  if (!account) notFound();
  const lines = await db.journalLine.findMany({
    where: { accountId: account.id, ...(project ? { projectId: project } : {}) },
    include: { entry: true, project: true, party: true, costCode: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
  });
  let running = 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2>
          كشف حساب <span className="num">{account.code}</span> · {account.name}
        </h2>
        <Link href={`/finance${project ? `?project=${project}` : ""}`} className="btn-secondary">
          رجوع لميزان المراجعة
        </Link>
      </div>
      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>القيد</th>
              <th>البيان</th>
              <th>المشروع</th>
              <th>الطرف / رمز التكلفة</th>
              <th>مدين</th>
              <th>دائن</th>
              <th>الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  لا توجد حركات.
                </td>
              </tr>
            )}
            {lines.map((l) => {
              running += normalBalance(account.type, l.debit, l.credit);
              return (
                <tr key={l.id}>
                  <td className="num">{fmtDate(l.entry.date)}</td>
                  <td className="num">{l.entry.number}</td>
                  <td>{l.memo ? `${l.entry.description} (${l.memo})` : l.entry.description}</td>
                  <td>{l.project?.code ?? "—"}</td>
                  <td>{l.party?.name ?? (l.costCode ? `${l.costCode.code} ${l.costCode.name}` : "—")}</td>
                  <td className="num">{l.debit ? fmtMoney(l.debit) : ""}</td>
                  <td className="num">{l.credit ? fmtMoney(l.credit) : ""}</td>
                  <td className="num font-semibold">{fmtMoney(running)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
