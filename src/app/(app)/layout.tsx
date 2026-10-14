import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, roleLabel } from "@/lib/permissions";
import { logout } from "../actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-slate-200 bg-brand-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-bold">
              نظام المقاولات
            </Link>
            <nav className="flex gap-4 text-sm text-brand-100">
              <Link href="/" className="hover:text-white">
                المشاريع
              </Link>
              {can(user.role, "store.view") && (
                <Link href="/stores" className="hover:text-white">
                  المستودعات
                </Link>
              )}
              {can(user.role, "equipment.view") && (
                <Link href="/equipment" className="hover:text-white">
                  المعدات
                </Link>
              )}
              {can(user.role, "hr.view") && (
                <Link href="/hr" className="hover:text-white">
                  الموارد البشرية
                </Link>
              )}
              {can(user.role, "finance.view") && (
                <Link href="/finance" className="hover:text-white">
                  المالية
                </Link>
              )}
              {can(user.role, "users.manage") && (
                <Link href="/admin/users" className="hover:text-white">
                  المستخدمون والصلاحيات
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>
              {user.name} <span className="text-brand-100">· {roleLabel(user.role)}</span>
            </span>
            <form action={logout}>
              <button className="rounded-md border border-brand-100/40 px-3 py-1 hover:bg-brand-700">خروج</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
