import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { convertRow, insertOrder } from "../scripts/migrate-sqlite-to-postgres";

const models = Prisma.dmmf.datamodel.models;
const model = (name: string) => models.find((m) => m.name === name)!;

describe("نقل البيانات من SQLite", () => {
  it("كل جدول يأتي بعد الجداول التي يشير إليها", () => {
    const order = insertOrder(models).map((m) => m.name);
    expect(order).toHaveLength(models.length);
    for (const m of models) {
      for (const f of m.fields) {
        if (f.kind === "object" && f.relationFromFields?.length && f.type !== m.name) {
          expect(order.indexOf(f.type), `${m.name} → ${f.type}`).toBeLessThan(order.indexOf(m.name));
        }
      }
    }
  });

  it("يحول التاريخ والمنطقي من صيغة SQLite", () => {
    const ms = Date.UTC(2026, 9, 15, 1, 0, 0);
    const row = convertRow(model("User"), {
      id: "u1", name: "م", email: "a@b.c", passwordHash: "h", role: "OWNER", active: 0, createdAt: ms,
    });
    expect(row.active).toBe(false);
    expect(row.createdAt).toEqual(new Date(ms));
    expect(convertRow(model("User"), { active: 1, createdAt: "2026-10-15T01:00:00.000Z" }).createdAt).toEqual(new Date(ms));
  });
});
