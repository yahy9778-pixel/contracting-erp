"use server";

import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { runAction } from "@/lib/flash";
import { DEPARTMENTS } from "@/lib/agents/departments";
import { runDepartmentAgent } from "@/lib/agents/department-agent";

export async function runAgent(projectId: string, key: string) {
  const path = `/projects/${projectId}/agents`;
  await runAction(path, async () => {
    const { user } = await requireProjectAccess(projectId, "agents.view");
    const dept = DEPARTMENTS.find((d) => d.key === key);
    if (!dept || !(dept.roles as string[]).includes(user.role)) throw new Error("ليست لديك صلاحية تشغيل وكيل هذا القسم");
    const snapshot = await dept.collect(projectId);
    const input = JSON.stringify(snapshot);
    try {
      const report = await runDepartmentAgent(dept, snapshot);
      const output = JSON.stringify(report);
      await db.agentReport.create({ data: { department: key, projectId, createdById: user.id, output } });
      await db.agentAction.create({ data: { agent: `dept:${key}`, userId: user.id, projectId, input, output, status: "SUCCESS" } });
    } catch (e) {
      await db.agentAction.create({ data: { agent: `dept:${key}`, userId: user.id, projectId, input, output: String(e), status: "ERROR" } });
      throw e;
    }
    return `${path}?notice=${encodeURIComponent(`أعد وكيل ${dept.name} تقريره`)}#${key}`;
  });
}
