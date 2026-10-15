import { describe, expect, it } from "vitest";
import { envProblems } from "@/lib/env";

const good = {
  SESSION_SECRET: "x".repeat(48),
  DATABASE_URL: "postgresql://erp:pw@db:5432/erp",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("فحص متغيرات البيئة", () => {
  it("إعداد سليم بلا أخطاء ولا تنبيهات", () => {
    expect(envProblems(good, true)).toEqual({ errors: [], warnings: [] });
  });

  it("التشغيل الفعلي يرفض المفتاح التجريبي والمفتاح القصير", () => {
    expect(envProblems({ ...good, SESSION_SECRET: "change-me-to-a-long-random-string" }, true).errors).toHaveLength(1);
    expect(envProblems({ ...good, SESSION_SECRET: "short-but-16chars" }, true).errors).toHaveLength(1);
  });

  it("التطوير يكتفي بالتنبيه على المفتاح القصير", () => {
    const r = envProblems({ ...good, SESSION_SECRET: "short-but-16chars" }, false);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("يرفض قاعدة غير PostgreSQL وغياب الرابط", () => {
    expect(envProblems({ ...good, DATABASE_URL: "file:./dev.db" }, true).errors).toHaveLength(1);
    expect(envProblems({ ...good, DATABASE_URL: undefined }, true).errors).toHaveLength(1);
  });

  it("غياب مفتاح Claude تنبيه فقط لأن النظام يعمل بدونه", () => {
    const r = envProblems({ ...good, ANTHROPIC_API_KEY: undefined }, true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});
