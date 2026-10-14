import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md text-center">
        <h1>الصفحة غير متاحة</h1>
        <p className="mt-2 text-sm text-slate-500">الصفحة غير موجودة أو ليست ضمن صلاحياتك.</p>
        <Link href="/" className="btn mt-4">
          العودة للمشاريع
        </Link>
      </div>
    </main>
  );
}
