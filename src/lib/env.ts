// فحص متغيرات البيئة عند تشغيل الخادم. في التشغيل الفعلي أي خطأ هنا يوقف الإقلاع
// بدل أن يعمل النظام بإعداد ناقص أو مفتاح تجريبي.
const EXAMPLE_SECRET = "change-me-to-a-long-random-string";

export function envProblems(env: Record<string, string | undefined>, production: boolean) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const secret = env.SESSION_SECRET ?? "";
  if (!secret) errors.push("SESSION_SECRET غير مضبوط");
  else if (secret === EXAMPLE_SECRET) (production ? errors : warnings).push("SESSION_SECRET ما زال القيمة التجريبية من .env.example");
  else if (secret.length < 32) (production ? errors : warnings).push("SESSION_SECRET أقصر من 32 حرفا");

  const url = env.DATABASE_URL ?? "";
  if (!url) errors.push("DATABASE_URL غير مضبوط");
  else if (!/^postgres(ql)?:\/\//.test(url)) errors.push("DATABASE_URL يجب أن يكون رابط PostgreSQL");

  if (!env.ANTHROPIC_API_KEY) warnings.push("ANTHROPIC_API_KEY غير مضبوط: الوكلاء الأذكياء معطلون");

  return { errors, warnings };
}
