import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { ROLES } from "@/lib/permissions";
import { createUser, updateUser } from "@/app/actions/users";
import { Flash, PageHeader } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const ROLE_OPTIONS = Object.entries(ROLES);

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission("users.manage");
  const { error, notice } = await searchParams;
  const [users, projects] = await Promise.all([
    db.user.findMany({ include: { memberships: true }, orderBy: { createdAt: "asc" } }),
    db.project.findMany({ orderBy: { code: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" sub="كل مستخدم يرى المشاريع المسندة إليه فقط، والمالك يرى الكل" />
      <Flash error={error} notice={notice} />
      <div className="space-y-4">
        {users.map((u) => {
          const assigned = new Set(u.memberships.map((m) => m.projectId));
          return (
            <form key={u.id} action={updateUser.bind(null, u.id)} className="card grid gap-4 md:grid-cols-4">
              <div>
                <div className="font-semibold">{u.name}</div>
                <div className="text-sm text-slate-500" dir="ltr">
                  {u.email}
                </div>
              </div>
              <div>
                <label>الدور</label>
                <select name="role" defaultValue={u.role}>
                  {ROLE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="mt-2 flex items-center gap-2 font-normal">
                  <input type="checkbox" name="active" defaultChecked={u.active} className="w-auto" />
                  الحساب مفعل
                </label>
              </div>
              <div>
                <label>المشاريع</label>
                <div className="max-h-28 space-y-1 overflow-y-auto text-sm">
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 font-normal">
                      <input type="checkbox" name="projects" value={p.id} defaultChecked={assigned.has(p.id)} className="w-auto" />
                      {p.code} · {p.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-between gap-2">
                <div>
                  <label>كلمة مرور جديدة (اختياري)</label>
                  <input name="password" type="password" dir="ltr" autoComplete="new-password" />
                </div>
                <button className="btn">حفظ</button>
              </div>
            </form>
          );
        })}
      </div>

      <form action={createUser} className="card mt-8 grid gap-4 md:grid-cols-5">
        <h2 className="md:col-span-5">إضافة مستخدم</h2>
        <div>
          <label>الاسم</label>
          <input name="name" required />
        </div>
        <div>
          <label>البريد</label>
          <input name="email" type="email" required dir="ltr" />
        </div>
        <div>
          <label>الدور</label>
          <select name="role" required>
            {ROLE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>كلمة المرور</label>
          <input name="password" type="password" required minLength={8} dir="ltr" autoComplete="new-password" />
        </div>
        <div className="flex items-end">
          <button className="btn w-full">إضافة</button>
        </div>
      </form>
    </>
  );
}
