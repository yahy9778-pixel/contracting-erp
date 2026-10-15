import { envProblems } from "@/lib/env";

// يعمل مرة واحدة عند إقلاع الخادم
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { errors, warnings } = envProblems(process.env, process.env.NODE_ENV === "production");
  for (const w of warnings) console.warn(`[env] تنبيه: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[env] خطأ: ${e}`);
    throw new Error("إعدادات البيئة غير صالحة، راجع docs/deploy/README.md");
  }
}
