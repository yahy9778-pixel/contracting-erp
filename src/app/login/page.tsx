import { login } from "../actions/auth";
import { Flash } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="mb-1">تسجيل الدخول</h1>
        <p className="mb-6 text-sm text-slate-500">نظام إدارة شركة المقاولات</p>
        <Flash error={error} />
        <form action={login} className="space-y-4">
          <div>
            <label htmlFor="email">البريد الإلكتروني</label>
            <input id="email" name="email" type="email" required dir="ltr" autoComplete="username" />
          </div>
          <div>
            <label htmlFor="password">كلمة المرور</label>
            <input id="password" name="password" type="password" required dir="ltr" autoComplete="current-password" />
          </div>
          <button className="btn w-full">دخول</button>
        </form>
      </div>
    </main>
  );
}
