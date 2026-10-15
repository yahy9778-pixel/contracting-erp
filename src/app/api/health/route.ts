import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// فحص الصحة لمنصة النشر والمراقبة: يتأكد أن التطبيق يعمل وأن قاعدة البيانات تستجيب
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", ms: Date.now() - started });
  } catch {
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
