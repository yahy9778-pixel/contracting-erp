import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { MODEL } from "./model";

// مخرجات وكيل القسم: تقرير متابعة مرتب بالأثر، كل ملاحظة لها دليل من البيانات وإجراء ومسؤول
export const DepartmentReport = z.object({
  headline: z.string().describe("جملة واحدة: أهم ما يحتاج انتباه القسم الآن"),
  status: z.enum(["ON_TRACK", "WATCH", "CRITICAL"]),
  findings: z.array(
    z.object({
      severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
      title: z.string(),
      evidence: z.string().describe("الأرقام أو السجلات من البيانات المرفقة التي بُنيت عليها الملاحظة"),
      action: z.string().describe("إجراء محدد قابل للتنفيذ"),
      owner: z.string().describe("القسم أو الدور المسؤول عن الإجراء"),
      due: z.string().nullable().describe("موعد مقترح YYYY-MM-DD أو null"),
    }),
  ),
  kpis: z.array(z.object({ label: z.string(), value: z.string() })).describe("3 إلى 6 مؤشرات رئيسية من البيانات"),
  questions: z.array(z.string()).describe("معلومات ناقصة يحتاجها القسم من الإدارة أو الأقسام الأخرى"),
});

export type DepartmentReport = z.infer<typeof DepartmentReport>;

export type AgentBrief = { name: string; duties: string[] };

export function buildSystemPrompt(dept: AgentBrief) {
  return `أنت وكيل قسم "${dept.name}" في نظام إدارة شركة مقاولات.
مهام القسم وواجباته:
${dept.duties.map((d) => `- ${d}`).join("\n")}

تستلم لقطة بيانات حقيقية من النظام لمشروع واحد بتاريخ اليوم، وتكتب تقرير متابعة للقسم.
القواعد:
- استند فقط إلى البيانات المرفقة. اذكر في evidence الرقم أو السجل الذي بنيت عليه كل ملاحظة. لا تخترع أرقاما أو أسماء.
- رتب الملاحظات من الأعلى أثرا على الوقت أو المال أو الجودة أو السلامة.
- كل إجراء محدد وقابل للتنفيذ، ومنسوب للقسم أو الدور المسؤول عنه.
- إذا كانت البيانات لا تكفي للحكم، لا تخمن: اكتب ما ينقص في questions.
- أنت تقترح فقط. لا تعتمد ولا ترحل ولا تنفذ أي شيء.
- اكتب بالعربية، والمصطلحات الفنية الشائعة بالإنجليزية (IPC, NCR, RFI, SPI...).`;
}

type ParseClient = Pick<Anthropic, "beta">;

export async function runDepartmentAgent(dept: AgentBrief, snapshot: unknown, client?: ParseClient): Promise<DepartmentReport> {
  if (!client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("لم يتم ضبط ANTHROPIC_API_KEY، لذلك وكلاء الأقسام غير مفعلين بعد");
  }
  const c = client ?? new Anthropic();
  const response = await c.beta.messages.parse({
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_tokens: 16000,
    system: buildSystemPrompt(dept),
    output_config: { effort: "medium", format: betaZodOutputFormat(DepartmentReport) },
    messages: [{ role: "user", content: `بيانات المشروع من النظام (JSON):\n${JSON.stringify(snapshot)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("رفض النموذج إعداد التقرير");
  if (response.stop_reason === "max_tokens") throw new Error("بيانات المشروع أكبر من حد الوكيل");
  if (!response.parsed_output) throw new Error("لم يتمكن الوكيل من إعداد التقرير");
  return response.parsed_output;
}
