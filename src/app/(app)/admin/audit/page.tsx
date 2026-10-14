import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

const ACTIONS: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  delete: "حذف",
  approve: "اعتماد",
  reject: "رفض",
  submit: "رفع",
  paid: "دفع",
  pay: "صرف",
  login: "دخول",
  login_failed: "دخول فاشل",
  change_password: "تغيير كلمة المرور",
  reverse: "عكس قيد",
  receive: "استلام",
  issue: "صرف مخزني",
  close: "إغلاق",
};

type Search = Promise<{ entity?: string; user?: string }>;

// سجل التدقيق: من فعل ماذا ومتى، لكل الأقسام
export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  await requirePagePermission("audit.view");
  const { entity, user } = await searchParams;
  const [logs, users, entities, agentRuns] = await Promise.all([
    db.auditLog.findMany({
      where: { ...(entity ? { entity } : {}), ...(user ? { userId: user } : {}) },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.auditLog.groupBy({ by: ["entity"], _count: true, orderBy: { entity: "asc" } }),
    db.agentAction.groupBy({ by: ["agent", "status"], _count: true }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="سجل التدقيق" sub="آخر 200 عملية. السجل لا يُعدَّل ولا يُحذف من النظام." />
      <form className="flex flex-wrap items-end gap-2">
        <select name="entity" defaultValue={entity ?? ""} className="w-auto">
          <option value="">كل السجلات</option>
          {entities.map((e) => (
            <option key={e.entity} value={e.entity}>
              {e.entity} ({e._count})
            </option>
          ))}
        </select>
        <select name="user" defaultValue={user ?? ""} className="w-auto">
          <option value="">كل المستخدمين</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary">عرض</button>
      </form>
      {agentRuns.length > 0 && (
        <p className="text-sm text-slate-600">
          تشغيلات الوكلاء: {agentRuns.map((a) => `${a.agent} ${a.status === "SUCCESS" ? "ناجح" : "فشل"} ${a._count}`).join("، ")}
        </p>
      )}
      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>الوقت (UTC)</th>
              <th>المستخدم</th>
              <th>العملية</th>
              <th>السجل</th>
              <th>تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className={l.action === "login_failed" ? "bg-red-50" : ""}>
                <td className="num">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>{l.user?.name ?? "النظام"}</td>
                <td>{ACTIONS[l.action] ?? l.action}</td>
                <td className="num text-xs">{l.entity}</td>
                <td className="num max-w-md truncate text-xs text-slate-500" dir="ltr">
                  {l.details ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
