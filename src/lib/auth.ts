import "server-only";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { can, type Permission } from "./permissions";

const COOKIE = "erp_session";
const MAX_AGE = 60 * 60 * 12; // 12 ساعة

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET غير مضبوط أو قصير جدا");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    return user?.active ? user : null;
  } catch {
    return null;
  }
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

// للصفحات: من لا يملك الصلاحية يرى "غير موجود" بدل رسالة خطأ
export async function requirePagePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) notFound();
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw new Error("ليست لديك صلاحية لهذا الإجراء");
  return user;
}

// المالك يرى كل المشاريع، والبقية يرون مشاريعهم فقط
export async function requireProjectAccess(projectId: string, permission?: Permission, opts: { page?: boolean } = {}) {
  const user = permission
    ? opts.page
      ? await requirePagePermission(permission)
      : await requirePermission(permission)
    : await requireUser();
  const project = await db.project.findUnique({ where: { id: projectId }, include: { client: true, consultant: true } });
  if (!project) notFound();
  if (!can(user.role, "projects.viewAll")) {
    const member = await db.projectMember.findUnique({ where: { userId_projectId: { userId: user.id, projectId } } });
    if (!member) notFound();
  }
  return { user, project };
}

export function projectScope(user: SessionUser) {
  return can(user.role, "projects.viewAll") ? {} : { members: { some: { userId: user.id } } };
}
