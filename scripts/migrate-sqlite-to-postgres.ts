// نقل البيانات من قاعدة SQLite التجريبية إلى PostgreSQL
// الاستخدام:
//   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-sqlite-to-postgres.ts ./prisma/dev.db
// الشروط: قاعدة PostgreSQL مهيأة بالهجرات (npx prisma migrate deploy) وفارغة من البيانات.
// النقل يتم في معاملة واحدة: إما ينجح كاملا أو لا يُكتب شيء.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Row = Record<string, unknown>;

const CHUNK = 500;

// ترتيب الجداول بحيث يأتي الجدول المرجعي قبل الجدول الذي يشير إليه
export function insertOrder(models: readonly Model[]): Model[] {
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    const set = new Set<string>();
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields?.length && f.type !== m.name) set.add(f.type);
    }
    deps.set(m.name, set);
  }
  const done = new Set<string>();
  const out: Model[] = [];
  while (out.length < models.length) {
    const ready = models.filter((m) => !done.has(m.name) && [...deps.get(m.name)!].every((d) => done.has(d)));
    if (!ready.length) throw new Error("علاقات دائرية بين الجداول تمنع تحديد ترتيب النقل");
    for (const m of ready) {
      done.add(m.name);
      out.push(m);
    }
  }
  return out;
}

// SQLite في Prisma يحفظ التاريخ كرقم (ميلي ثانية) أو نص، والمنطقي كـ 0/1
export function convertRow(model: Model, row: Row): Row {
  const out: Row = {};
  for (const f of model.fields) {
    if (f.kind !== "scalar" && f.kind !== "enum") continue;
    const v = row[f.name];
    if (v === null || v === undefined) {
      out[f.name] = null;
      continue;
    }
    switch (f.type) {
      case "DateTime":
        out[f.name] = new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : (v as string | number));
        break;
      case "Boolean":
        out[f.name] = v === 1 || v === 1n || v === true || v === "1" || v === "true";
        break;
      case "Int":
      case "Float":
        out[f.name] = Number(v);
        break;
      default:
        out[f.name] = v;
    }
  }
  return out;
}

function delegate(db: Prisma.TransactionClient, model: string) {
  const key = model[0].toLowerCase() + model.slice(1);
  return (db as unknown as Record<string, { createMany(a: { data: Row[] }): Promise<unknown>; count(): Promise<number> }>)[key];
}

async function main() {
  const file = process.argv[2];
  if (!file || !existsSync(file)) throw new Error("حدد مسار ملف SQLite، مثال: ./prisma/dev.db");
  if (!process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("DATABASE_URL يجب أن يشير إلى PostgreSQL");

  const sqlite = new DatabaseSync(file, { readOnly: true });
  const db = new PrismaClient();
  const models = insertOrder(Prisma.dmmf.datamodel.models);
  const sqliteTables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name),
  );

  for (const m of models) {
    if ((await delegate(db, m.name).count()) > 0) {
      throw new Error(`قاعدة PostgreSQL ليست فارغة (الجدول ${m.name} فيه بيانات). أوقفت النقل حتى لا تتكرر البيانات`);
    }
  }

  const counts: [string, number][] = [];
  await db.$transaction(
    async (tx) => {
      for (const m of models) {
        const table = m.dbName ?? m.name;
        if (!sqliteTables.has(table)) {
          counts.push([m.name, 0]);
          continue;
        }
        const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Row[];
        for (let i = 0; i < rows.length; i += CHUNK) {
          await delegate(tx, m.name).createMany({ data: rows.slice(i, i + CHUNK).map((r) => convertRow(m, r)) });
        }
        counts.push([m.name, rows.length]);
      }
    },
    { timeout: 10 * 60_000, maxWait: 60_000 },
  );

  // تحقق: عدد السجلات في كل جدول يطابق المصدر
  let mismatch = 0;
  for (const [name, expected] of counts) {
    const actual = await delegate(db, name).count();
    if (actual !== expected) {
      mismatch++;
      console.error(`✗ ${name}: المصدر ${expected} والهدف ${actual}`);
    }
  }
  const total = counts.reduce((s, [, n]) => s + n, 0);
  await db.$disconnect();
  sqlite.close();
  if (mismatch) throw new Error(`اختلاف في ${mismatch} جدول`);
  console.log(`تم نقل ${total} سجلا من ${counts.filter(([, n]) => n).length} جدولا، والأعداد مطابقة للمصدر`);
}

if (process.argv[1]?.includes("migrate-sqlite-to-postgres")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
