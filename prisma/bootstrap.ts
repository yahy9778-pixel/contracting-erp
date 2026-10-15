// تهيئة قاعدة التشغيل الفعلي: البيانات الأساسية وحساب المالك فقط، بدون أي بيانات تجريبية
// الاستخدام (مرة واحدة بعد أول نشر):
//   ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="..." ADMIN_NAME="الاسم" npx tsx prisma/bootstrap.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ensureBaseData } from "./base-data";

const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = process.env.ADMIN_NAME?.trim() || "المالك";
  if (!email || !email.includes("@")) throw new Error("ضع بريد المالك في ADMIN_EMAIL");
  if (password.length < 12) throw new Error("كلمة مرور المالك يجب أن تكون 12 حرفا على الأقل (ADMIN_PASSWORD)");

  await ensureBaseData(db);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`البيانات الأساسية محدثة، وحساب ${email} موجود مسبقا ولم يُعدَّل`);
    return;
  }
  await db.user.create({ data: { name, email, role: "OWNER", passwordHash: await bcrypt.hash(password, 10) } });
  console.log(`تمت التهيئة: رموز التكلفة ودليل الحسابات، وحساب المالك ${email}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
