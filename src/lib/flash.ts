import { redirect } from "next/navigation";

export type SearchParams = Promise<{ error?: string; notice?: string }>;

// تشغيل إجراء ثم العودة للصفحة برسالة نجاح أو خطأ
export async function runAction(path: string, fn: () => Promise<string | void>, notice?: string): Promise<never> {
  let target: string;
  try {
    const result = await fn();
    target = typeof result === "string" ? result : `${path}${notice ? `?notice=${encodeURIComponent(notice)}` : ""}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "حدث خطأ غير متوقع";
    target = `${path}?error=${encodeURIComponent(msg)}`;
  }
  redirect(target);
}

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function num(form: FormData, key: string, fallback = 0): number {
  const raw = str(form, key).replace(/,/g, "");
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`قيمة رقمية غير صحيحة في الحقل: ${key}`);
  return n;
}
