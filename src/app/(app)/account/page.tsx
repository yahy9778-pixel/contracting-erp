import { requireUser } from "@/lib/auth";
import { roleLabel } from "@/lib/permissions";
import { changePassword } from "@/app/actions/auth";
import { Flash, PageHeader } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { error, notice } = await searchParams;
  return (
    <div className="max-w-md">
      <PageHeader title="حسابي" sub={`${user.name} · ${roleLabel(user.role)}`} />
      <Flash error={error} notice={notice} />
      <form action={changePassword} className="card space-y-4">
        <h2>تغيير كلمة المرور</h2>
        <div>
          <label htmlFor="current">كلمة المرور الحالية</label>
          <input id="current" name="current" type="password" required dir="ltr" autoComplete="current-password" />
        </div>
        <div>
          <label htmlFor="next">الجديدة (10 أحرف على الأقل، حروف وأرقام)</label>
          <input id="next" name="next" type="password" required minLength={10} dir="ltr" autoComplete="new-password" />
        </div>
        <div>
          <label htmlFor="confirm">تأكيد الجديدة</label>
          <input id="confirm" name="confirm" type="password" required dir="ltr" autoComplete="new-password" />
        </div>
        <button className="btn">حفظ</button>
      </form>
    </div>
  );
}
