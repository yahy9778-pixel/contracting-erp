"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str } from "@/lib/flash";

export async function login(form: FormData) {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    redirect(`/login?error=${encodeURIComponent("البريد أو كلمة المرور غير صحيحة")}`);
  }
  await createSession(user.id);
  await audit(user.id, "login", "User", user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
