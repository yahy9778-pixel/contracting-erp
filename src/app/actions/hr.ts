"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { num, runAction, str } from "@/lib/flash";
import { parseDay } from "@/lib/format";
import { cashAccountCode, postPayrollApproval, postPayrollPayment } from "@/lib/accounting";
import { PAYROLL_DAYS, payrollLine } from "@/lib/operations";

const HR = "/hr";
const runPath = (id: string) => `/hr/payroll/${id}`;

function employeeData(form: FormData) {
  const basicSalary = num(form, "basicSalary");
  const allowances = num(form, "allowances");
  if (basicSalary <= 0 || allowances < 0) throw new Error("الراتب الأساسي مطلوب والبدلات لا تكون سالبة");
  const idExpiry = str(form, "idExpiry");
  return {
    jobTitle: str(form, "jobTitle"),
    kind: str(form, "kind") === "STAFF" ? "STAFF" : "LABOR",
    trade: str(form, "trade") || null,
    basicSalary,
    allowances,
    projectId: str(form, "projectId") || null,
    idExpiry: idExpiry ? parseDay(idExpiry) : null,
  };
}

export async function createEmployee(form: FormData) {
  await runAction(
    HR,
    async () => {
      const user = await requirePermission("hr.manage");
      const name = str(form, "name");
      const joinDate = str(form, "joinDate");
      if (!name || !joinDate || !str(form, "jobTitle")) throw new Error("الاسم والمسمى الوظيفي وتاريخ المباشرة مطلوبة");
      const count = await db.employee.count();
      const e = await db.employee.create({
        data: { code: `EMP-${String(count + 1).padStart(4, "0")}`, name, nationalId: str(form, "nationalId") || null, joinDate: parseDay(joinDate), ...employeeData(form) },
      });
      await audit(user.id, "create", "Employee", e.id);
    },
    "تمت إضافة الموظف",
  );
}

export async function updateEmployee(employeeId: string, form: FormData) {
  await runAction(
    HR,
    async () => {
      const user = await requirePermission("hr.manage");
      await db.employee.update({ where: { id: employeeId }, data: { ...employeeData(form), active: str(form, "active") !== "no" } });
      await audit(user.id, "update", "Employee", employeeId);
    },
    "تم تحديث بيانات الموظف",
  );
}

// مسير الشهر لكل الموظفين النشطين: 30 يوما، أو من تاريخ المباشرة إن باشر خلال الشهر
export async function generatePayroll(form: FormData) {
  await runAction("/hr/payroll", async () => {
    const user = await requirePermission("hr.manage");
    const month = str(form, "month");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("حدد الشهر");
    if (await db.payrollRun.findUnique({ where: { month } })) throw new Error("مسير هذا الشهر موجود");
    const monthStart = parseDay(`${month}-01`);
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
    const employees = await db.employee.findMany({ where: { active: true, joinDate: { lte: monthEnd } } });
    if (!employees.length) throw new Error("لا يوجد موظفون نشطون في هذا الشهر");
    const run = await db.payrollRun.create({
      data: {
        month,
        createdById: user.id,
        lines: {
          create: employees.map((e) => {
            const daysWorked = e.joinDate > monthStart ? Math.max(0, PAYROLL_DAYS - (e.joinDate.getUTCDate() - 1)) : PAYROLL_DAYS;
            const calc = payrollLine({ basicSalary: e.basicSalary, allowances: e.allowances, daysWorked, overtimeHours: 0, deductions: 0 });
            return { employeeId: e.id, projectId: e.projectId, daysWorked, ...calc, overtimeHours: 0 };
          }),
        },
      },
    });
    await audit(user.id, "create", "PayrollRun", run.id, { month, employees: employees.length });
    return `${runPath(run.id)}?notice=${encodeURIComponent("تم إعداد المسير، راجع أيام العمل والإضافي والخصومات")}`;
  });
}

export async function updatePayrollLine(runId: string, lineId: string, form: FormData) {
  await runAction(
    runPath(runId),
    async () => {
      const user = await requirePermission("hr.manage");
      const line = await db.payrollLine.findFirst({ where: { id: lineId, runId }, include: { run: true, employee: true } });
      if (!line || line.run.status !== "DRAFT") throw new Error("المسير معتمد، لا يمكن التعديل");
      const daysWorked = num(form, "daysWorked");
      const overtimeHours = num(form, "overtimeHours");
      const calc = payrollLine({ basicSalary: line.employee.basicSalary, allowances: line.employee.allowances, daysWorked, overtimeHours, deductions: num(form, "deductions") });
      await db.payrollLine.update({ where: { id: lineId }, data: { daysWorked, overtimeHours, ...calc } });
      await audit(user.id, "update", "PayrollLine", lineId);
    },
    "تم تحديث السطر",
  );
}

export async function approvePayroll(runId: string) {
  await runAction(
    runPath(runId),
    async () => {
      const user = await requirePermission("payroll.approve");
      const run = await db.payrollRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== "DRAFT") throw new Error("المسير ليس مسودة");
      await db.$transaction(async (tx) => {
        await tx.payrollRun.update({ where: { id: runId }, data: { status: "APPROVED", approvedAt: new Date() } });
        await postPayrollApproval(tx, runId, user.id);
      });
      await audit(user.id, "approve", "PayrollRun", runId);
    },
    "تم اعتماد المسير وتحميل الرواتب على المشاريع",
  );
}

export async function payPayroll(runId: string, form: FormData) {
  await runAction(
    runPath(runId),
    async () => {
      const user = await requirePermission("payroll.pay");
      const run = await db.payrollRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== "APPROVED") throw new Error("المسير غير معتمد بعد");
      await db.$transaction(async (tx) => {
        await tx.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: new Date() } });
        await postPayrollPayment(tx, runId, await cashAccountCode(tx, str(form, "cashAccount")), user.id);
      });
      await audit(user.id, "pay", "PayrollRun", runId);
    },
    "تم تسجيل صرف الرواتب",
  );
}

export async function deletePayroll(runId: string) {
  await runAction("/hr/payroll", async () => {
    const user = await requirePermission("hr.manage");
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "DRAFT") throw new Error("يمكن حذف المسودة فقط");
    await db.payrollRun.delete({ where: { id: runId } });
    await audit(user.id, "delete", "PayrollRun", runId);
    return `/hr/payroll?notice=${encodeURIComponent("تم حذف المسودة")}`;
  });
}
