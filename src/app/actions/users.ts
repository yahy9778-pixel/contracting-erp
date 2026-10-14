"use server";

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ROLES } from "@/lib/permissions";
import { runAction, str } from "@/lib/flash";

const PATH = "/admin/users";

function checkRole(role: string) {
  if (!(role in ROLES)) throw new Error("دور غير معروف");
}

export async function createUser(form: FormData) {
  await runAction(
    PATH,
    async () => {
      const admin = await requirePermission("users.manage");
      const name = str(form, "name");
      const email = str(form, "email").toLowerCase();
      const role = str(form, "role");
      const password = str(form, "password");
      checkRole(role);
      if (!name || !email) throw new Error("الاسم والبريد مطلوبان");
      if (password.length < 8) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف");
      if (await db.user.findUnique({ where: { email } })) throw new Error("البريد مستخدم من قبل");
      const user = await db.user.create({ data: { name, email, role, passwordHash: await bcrypt.hash(password, 10) } });
      await audit(admin.id, "create", "User", user.id, { email, role });
    },
    "تمت إضافة المستخدم",
  );
}

export async function updateUser(userId: string, form: FormData) {
  await runAction(
    PATH,
    async () => {
      const admin = await requirePermission("users.manage");
      const role = str(form, "role");
      checkRole(role);
      const active = form.get("active") === "on";
      if (userId === admin.id && (role !== "OWNER" || !active)) throw new Error("لا يمكنك إلغاء صلاحيتك أو تعطيل حسابك");
      const projectIds = form.getAll("projects").map(String);
      const password = str(form, "password");
      if (password && password.length < 8) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف");
      await db.$transaction([
        db.user.update({
          where: { id: userId },
          data: { role, active, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
        }),
        db.projectMember.deleteMany({ where: { userId } }),
        db.projectMember.createMany({ data: projectIds.map((projectId) => ({ userId, projectId })) }),
      ]);
      await audit(admin.id, "update", "User", userId, { role, active, projects: projectIds.length, passwordReset: Boolean(password) });
    },
    "تم حفظ بيانات المستخدم",
  );
}
