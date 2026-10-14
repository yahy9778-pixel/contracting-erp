import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

// وكيل التقرير اليومي: يحول رسالة مهندس الموقع (نص حر) إلى تقرير يومي منظم
// لا يعتمد شيئا بنفسه: الناتج مسودة يراجعها المهندس ثم يرفعها للاعتماد

export { MODEL } from "./model";
import { MODEL } from "./model";

export const DailyReportDraft = z.object({
  date: z.string().nullable().describe("تاريخ التقرير بصيغة YYYY-MM-DD إن ذُكر صراحة، وإلا null"),
  weather: z.string().nullable(),
  manpower: z.array(z.object({ trade: z.string(), count: z.number().int() })),
  equipment: z.array(z.object({ name: z.string(), count: z.number().int(), hours: z.number().nullable() })),
  progress: z.array(
    z.object({
      itemNo: z.string().describe("رقم البند من جدول الكميات كما هو في القائمة"),
      quantity: z.number().describe("الكمية المنفذة اليوم بوحدة البند"),
      location: z.string().nullable(),
    }),
  ),
  unmatched: z.array(z.string()).describe("أعمال ذُكرت ولم تجد لها بندا مطابقا، أو كمية بوحدة لا تطابق البند"),
  issues: z.array(z.string()).describe("مشاكل أو معوقات أو طلبات مواد ذكرها المهندس"),
  notes: z.string().nullable(),
});

export type DailyReportDraft = z.infer<typeof DailyReportDraft>;

export type BoqRef = { itemNo: string; description: string; unit: string };

const SYSTEM = `أنت وكيل التقرير اليومي في نظام شركة مقاولات.
يرسل لك مهندس الموقع وصفا حرا لما تم اليوم (بالعربية أو الإنجليزية أو مزيج)، ومعه قائمة بنود جدول الكميات (BOQ) للمشروع.
استخرج تقريرا يوميا منظما:
- طابق كل عمل منفذ مع بند واحد من القائمة، واستخدم رقم البند كما هو حرفيا.
- إذا لم تكن متأكدا من المطابقة، أو كانت الوحدة لا تطابق وحدة البند ولا يمكن تحويلها بأمان، ضع العمل في unmatched ولا تخمن.
- لا تخترع كميات أو أعدادا لم تُذكر.
- اكتب أسماء المهن والمعدات بالعربية.`;

export async function runDailyReportAgent(text: string, boq: BoqRef[]): Promise<DailyReportDraft> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("لم يتم ضبط ANTHROPIC_API_KEY، لذلك الوكيل الذكي غير مفعل بعد");
  }
  const client = new Anthropic();

  const boqList = boq.map((b) => `${b.itemNo} | ${b.description} | ${b.unit}`).join("\n");

  // fallbacks: "default" يعيد المحاولة على نموذج بديل إذا رفض النموذج الأساسي الطلب
  const response = await client.beta.messages.parse({
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(DailyReportDraft) },
    messages: [
      {
        role: "user",
        content: `بنود جدول الكميات (رقم البند | الوصف | الوحدة):\n${boqList}\n\nرسالة مهندس الموقع:\n${text}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("رفض النموذج معالجة هذا النص");
  if (response.stop_reason === "max_tokens") throw new Error("النص طويل جدا، قسمه على أكثر من تقرير");
  if (!response.parsed_output) throw new Error("لم يتمكن الوكيل من تنظيم التقرير، جرب صياغة أوضح");

  // تحقق إضافي: نتجاهل أي رقم بند غير موجود في المشروع
  const known = new Set(boq.map((b) => b.itemNo));
  const out = response.parsed_output;
  const bad = out.progress.filter((p) => !known.has(p.itemNo));
  return {
    ...out,
    progress: out.progress.filter((p) => known.has(p.itemNo) && p.quantity > 0),
    unmatched: [...out.unmatched, ...bad.map((p) => `بند غير موجود: ${p.itemNo} (${p.quantity})`)],
  };
}
