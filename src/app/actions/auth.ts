"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runAction, str } from "@/lib/flash";

// بعد 5 محاولات فاشلة لنفس البريد خلال 15 دقيقة يُوقف الدخول مؤقتا
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function login(form: FormData) {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await db.loginAttempt.count({ where: { email, createdAt: { gte: since } } });
  if (failures >= MAX_ATTEMPTS) {
    redirect(`/login?error=${encodeURIComponent("محاولات دخول كثيرة خاطئة. حاول بعد 15 دقيقة أو اطلب من المالك إعادة تعيين كلمة المرور")}`);
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    await db.loginAttempt.create({ data: { email } });
    if (user) await audit(user.id, "login_failed", "User", user.id);
    redirect(`/login?error=${encodeURIComponent("البريد أو كلمة المرور غير صحيحة")}`);
  }
  await db.loginAttempt.deleteMany({ where: { email } });
  await createSession(user.id);
  await audit(user.id, "login", "User", user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function changePassword(form: FormData) {
  await runAction(
    "/account",
    async () => {
      const user = await requireUser();
      const current = str(form, "current");
      const next = str(form, "next");
      if (!(await bcrypt.compare(current, user.passwordHash))) throw new Error("كلمة المرور الحالية غير صحيحة");
      if (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) throw new Error("كلمة المرور الجديدة: 10 أحرف على الأقل وتحتوي حروفا وأرقاما");
      if (next !== str(form, "confirm")) throw new Error("التأكيد لا يطابق كلمة المرور الجديدة");
      if (next === current) throw new Error("اختر كلمة مرور مختلفة عن الحالية");
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
      await audit(user.id, "change_password", "User", user.id);
    },
    "تم تغيير كلمة المرور",
  );
}
