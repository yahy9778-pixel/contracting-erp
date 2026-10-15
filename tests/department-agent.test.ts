import { describe, expect, it } from "vitest";
import { buildSystemPrompt, DepartmentReport, runDepartmentAgent } from "@/lib/agents/department-agent";

const report: DepartmentReport = {
  headline: "ضمان الدفعة المقدمة ينتهي بعد 22 يوما",
  status: "WATCH",
  findings: [{ severity: "HIGH", title: "تمديد الضمان", evidence: "daysLeft: 22", action: "طلب التمديد من البنك", owner: "الإدارة المالية", due: "2026-10-20" }],
  kpis: [{ label: "SPI", value: "0.24" }],
  questions: [],
};

// عميل وهمي يسجل الطلب ويعيد مخرجات منظمة
function fakeClient(stop_reason = "end_turn") {
  const calls: any[] = [];
  const client = { beta: { messages: { parse: async (req: any) => (calls.push(req), { stop_reason, parsed_output: report }) } } };
  return { client: client as any, calls };
}

describe("department agent", () => {
  const dept = { name: "الإدارة المالية", duties: ["متابعة السيولة", "متابعة خطابات الضمان"] };

  it("puts the department duties and the no-invention rule in the system prompt", () => {
    const p = buildSystemPrompt(dept);
    expect(p).toContain("الإدارة المالية");
    expect(p).toContain("- متابعة خطابات الضمان");
    expect(p).toContain("لا تخترع");
  });

  it("sends the snapshot as JSON with the configured model and returns the parsed report", async () => {
    const { client, calls } = fakeClient();
    const out = await runDepartmentAgent(dept, { guarantees: [{ daysLeft: 22 }] }, client);
    expect(out).toEqual(report);
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].messages[0].content).toContain('"daysLeft":22');
  });

  it("surfaces a refusal as an error", async () => {
    const { client } = fakeClient("refusal");
    await expect(runDepartmentAgent(dept, {}, client)).rejects.toThrow();
  });

  it("normalizes status and severity values the API does not enforce instead of failing the report", () => {
    const out = DepartmentReport.parse({ ...report, status: "critical", findings: [{ ...report.findings[0], severity: "عالية" }] });
    expect(out.status).toBe("CRITICAL");
    expect(out.findings[0].severity).toBe("MEDIUM");
    expect(DepartmentReport.parse({ ...report, status: "on track" }).status).toBe("ON_TRACK");
  });
});
