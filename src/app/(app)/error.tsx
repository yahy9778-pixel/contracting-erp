"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg text-center">
      <h2>حدث خطأ أثناء عرض الصفحة</h2>
      <p className="mt-2 text-sm text-slate-500">تم تسجيل الخطأ. حاول مرة أخرى، وإن تكرر أبلغ قسم تقنية المعلومات.</p>
      <button className="btn mt-4" onClick={reset}>
        إعادة المحاولة
      </button>
    </div>
  );
}
