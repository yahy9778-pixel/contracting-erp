// بيانات أولية: رموز التكلفة، مستخدمون تجريبيون، ومشروع تجريبي بجدول كميات
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ACC } from "../src/lib/ledger";
import { ensureBaseData } from "./base-data";
import { postEntry, syncPostings } from "../src/lib/accounting";

const db = new PrismaClient();

const USERS = [
  { name: "المالك", email: "owner@company.local", role: "OWNER" },
  { name: "مدير المشروع", email: "pm@company.local", role: "PROJECT_MANAGER" },
  { name: "مهندس الموقع", email: "site@company.local", role: "SITE_ENGINEER" },
  { name: "مهندس العقود", email: "contracts@company.local", role: "CONTRACTS" },
  { name: "المحاسب", email: "finance@company.local", role: "FINANCE" },
  { name: "مهندس الجودة", email: "qc@company.local", role: "QUALITY" },
  { name: "المكتب الفني", email: "technical@company.local", role: "TECHNICAL" },
  { name: "مسؤول المشتريات", email: "procurement@company.local", role: "PROCUREMENT" },
  { name: "مهندس التخطيط", email: "planning@company.local", role: "PLANNING" },
  { name: "أمين المستودعات", email: "store@company.local", role: "STOREKEEPER" },
  { name: "مسؤول الموارد البشرية", email: "hr@company.local", role: "HR" },
  { name: "مدير المعدات والورشة", email: "equipment@company.local", role: "EQUIPMENT" },
  { name: "مسؤول السلامة", email: "safety@company.local", role: "SAFETY" },
];

const EMPLOYEES: [string, string, "STAFF" | "LABOR", string | null, number, number, boolean, string | null][] = [
  // الاسم، المسمى، النوع، المهنة، الأساسي، البدلات، في الموقع، انتهاء الإقامة
  ["سالم العتيبي", "مدير مشروع", "STAFF", null, 14000, 4500, true, null],
  ["محمد رفيق", "مهندس موقع", "STAFF", null, 8000, 2500, true, "2027-03-10"],
  ["أحمد خان", "مراقب عمال", "LABOR", "مراقب", 3500, 800, true, "2026-11-02"],
  ["راجيش كومار", "نجار مسلح", "LABOR", "نجار", 1800, 500, true, "2027-05-20"],
  ["عبدالله نور", "حداد مسلح", "LABOR", "حداد", 1800, 500, true, "2027-01-15"],
  ["جون مارك", "عامل عادي", "LABOR", "عامل", 1200, 400, true, "2027-06-01"],
  ["خالد الزهراني", "محاسب", "STAFF", null, 9000, 2700, false, null],
  ["نورة القحطاني", "أخصائية موارد بشرية", "STAFF", null, 8500, 2500, false, null],
];

// تواريخ تنفيذ تجريبية لكل بند (خطة المشروع)
const PLAN: Record<string, [string, string]> = {
  "1.01": ["2026-09-01", "2026-10-31"],
  "1.02": ["2026-10-15", "2026-12-15"],
  "2.01": ["2026-09-20", "2026-10-20"],
  "2.02": ["2026-10-01", "2026-11-30"],
  "2.03": ["2026-11-15", "2027-03-31"],
  "2.04": ["2026-12-01", "2027-04-30"],
  "3.01": ["2027-02-01", "2027-06-15"],
  "3.02": ["2027-03-15", "2027-07-15"],
  "3.03": ["2027-05-01", "2027-08-20"],
  "4.01": ["2027-01-15", "2027-07-31"],
  "5.01": ["2026-11-01", "2027-06-30"],
  "6.01": ["2027-05-01", "2027-07-31"],
};
const day = (s: string) => new Date(`${s}T00:00:00Z`);

// المرحلة الثالثة: الحسابات والموازنة والجدول الزمني وخطابات الضمان للمشروع التجريبي
async function setupFinanceAndPlanning(projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { boqItems: { include: { costCode: true } } } });
  if (!(await db.activity.count({ where: { projectId } }))) {
    await db.activity.createMany({
      data: project.boqItems.map((i, idx) => ({
        projectId,
        code: i.itemNo,
        name: i.description,
        startDate: day(PLAN[i.itemNo]?.[0] ?? "2026-09-01"),
        endDate: day(PLAN[i.itemNo]?.[1] ?? "2027-08-31"),
        weight: i.quantity * i.rate,
        boqItemId: i.id,
        sortOrder: idx,
      })),
    });
  }
  if (!(await db.costBudget.count({ where: { projectId } }))) {
    // موازنة تجريبية: 82% من قيمة بنود كل رمز تكلفة، و3% من العقد مصاريف موقع عامة
    const byCode = new Map<string, number>();
    for (const i of project.boqItems) if (i.costCodeId) byCode.set(i.costCodeId, (byCode.get(i.costCodeId) ?? 0) + i.quantity * i.rate * 0.82);
    const g1 = await db.costCode.findUniqueOrThrow({ where: { code: "G1" } });
    const e1 = await db.costCode.findUniqueOrThrow({ where: { code: "E1" } });
    byCode.set(g1.id, project.contractValue * 0.03);
    byCode.set(e1.id, 150_000);
    await db.costBudget.createMany({ data: [...byCode].map(([costCodeId, amount]) => ({ projectId, costCodeId, amount: Math.round(amount) })) });
  }
  if (!(await db.bankGuarantee.count({ where: { projectId } }))) {
    await db.bankGuarantee.createMany({
      data: [
        { projectId, type: "PERFORMANCE", bank: "البنك الأهلي", number: "LG-2026-0147", amount: Math.round(project.contractValue * 0.05), issueDate: day("2026-08-20"), expiryDate: day("2027-09-30") },
        { projectId, type: "ADVANCE", bank: "البنك الأهلي", number: "LG-2026-0148", amount: project.advanceAmount, issueDate: day("2026-08-20"), expiryDate: day("2026-11-05") },
      ],
    });
  }
}

// المرحلة الرابعة: مستودعات وموظفون ومعدات تجريبية
async function setupOperations(projectId: string) {
  if (!(await db.warehouse.count())) {
    await db.warehouse.createMany({
      data: [
        { code: "WH-01", name: "المستودع المركزي" },
        { code: "WH-P1", name: "مستودع موقع PRJ-001", projectId },
      ],
    });
  }
  if (!(await db.employee.count())) {
    for (const [i, [name, jobTitle, kind, trade, basicSalary, allowances, onSite, expiry]] of EMPLOYEES.entries()) {
      await db.employee.create({
        data: {
          code: `EMP-${String(i + 1).padStart(4, "0")}`,
          name,
          jobTitle,
          kind,
          trade,
          basicSalary,
          allowances,
          projectId: onSite ? projectId : null,
          joinDate: day("2026-08-01"),
          idExpiry: expiry ? day(expiry) : null,
        },
      });
    }
  }
  if (!(await db.equipment.count())) {
    const lessor =
      (await db.party.findFirst({ where: { name: "شركة تأجير الرافعات (تجريبي)" } })) ??
      (await db.party.create({ data: { name: "شركة تأجير الرافعات (تجريبي)", type: "SUPPLIER", category: "F3" } }));
    await db.equipment.createMany({
      data: [
        { code: "EX-01", name: "حفار كاتربيلر 320", costCode: "E3", hourlyRate: 180, projectId, status: "ACTIVE", meterHours: 1180, lastServiceAt: 950, serviceInterval: 250 },
        { code: "TC-01", name: "رافعة برجية 8 طن", costCode: "F3", ownership: "RENTED", supplierId: lessor.id, hourlyRate: 260, projectId, status: "ACTIVE" },
        { code: "PM-01", name: "مضخة خرسانة", costCode: "F2", hourlyRate: 220, status: "IDLE", meterHours: 640, lastServiceAt: 500, serviceInterval: 500 },
      ],
    });
  }
}

async function setupDemoCapital() {
  // رأس مال افتتاحي تجريبي في البنك
  await db.$transaction((tx) =>
    postEntry(tx, {
      date: day("2026-08-15"),
      description: "رأس المال الافتتاحي (بيانات تجريبية)",
      sourceKey: "SEED:CAPITAL",
      kind: "MANUAL",
      lines: [
        { account: ACC.BANK, debit: 1_000_000 },
        { account: ACC.CAPITAL, credit: 1_000_000 },
      ],
    }),
  );
}

const BOQ: [string, string, string, number, number, string][] = [
  ["1.01", "حفر للأساسات في أي نوع من التربة", "م3", 2400, 35, "D1"],
  ["1.02", "ردم وتسوية بالدمك على طبقات", "م3", 1800, 28, "D1"],
  ["2.01", "خرسانة عادية للنظافة سماكة 10 سم", "م3", 120, 320, "D3"],
  ["2.02", "خرسانة مسلحة للقواعد", "م3", 650, 950, "D3"],
  ["2.03", "خرسانة مسلحة للأعمدة", "م3", 280, 1150, "D3"],
  ["2.04", "خرسانة مسلحة للأسقف والكمرات", "م3", 900, 1050, "D3"],
  ["3.01", "مباني بلوك أسمنتي 20 سم", "م2", 5200, 65, "D5"],
  ["3.02", "لياسة داخلية", "م2", 9800, 32, "D5"],
  ["3.03", "دهانات داخلية ثلاثة أوجه", "م2", 9800, 25, "D5"],
  ["4.01", "تمديدات كهربائية للإنارة", "نقطة", 850, 180, "D6"],
  ["5.01", "تمديدات صرف صحي PVC قطر 4 بوصة", "م.ط", 1200, 95, "D7"],
  ["6.01", "عزل مائي للأسطح بالرولات", "م2", 1500, 70, "D5"],
];

async function main() {
  await ensureBaseData(db);

  const passwordHash = await bcrypt.hash("Demo@12345", 10);
  const users = [];
  for (const u of USERS) {
    users.push(await db.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } }));
  }

  const existing = await db.project.findUnique({ where: { code: "PRJ-001" } });
  if (existing) {
    for (const u of users.filter((x) => x.role !== "OWNER")) {
      await db.projectMember.upsert({
        where: { userId_projectId: { userId: u.id, projectId: existing.id } },
        update: {},
        create: { userId: u.id, projectId: existing.id },
      });
    }
    await setupDemoCapital();
    await setupFinanceAndPlanning(existing.id);
    await setupOperations(existing.id);
    const posted = await syncPostings();
    console.log(`المشروع التجريبي موجود مسبقا: تم تحديث أعضائه، وترحيل ${posted} قيدا لأحداث سابقة`);
    return;
  }

  const client = await db.party.create({ data: { name: "شركة التطوير العقاري (عميل تجريبي)", type: "CLIENT", category: "A" } });
  const consultant = await db.party.create({ data: { name: "مكتب الاستشارات الهندسية (تجريبي)", type: "CONSULTANT", category: "B3" } });
  const codes = new Map((await db.costCode.findMany()).map((c) => [c.code, c.id]));

  const contractValue = BOQ.reduce((s, b) => s + b[3] * b[4], 0);
  const project = await db.project.create({
    data: {
      code: "PRJ-001",
      name: "مبنى سكني تجريبي - 4 أدوار",
      location: "الموقع التجريبي",
      clientId: client.id,
      consultantId: consultant.id,
      contractValue,
      startDate: new Date("2026-09-01T00:00:00Z"),
      endDate: new Date("2027-08-31T00:00:00Z"),
      retentionPct: 10,
      advanceAmount: Math.round(contractValue * 0.1),
      vatPct: 15,
      members: { create: users.filter((u) => u.role !== "OWNER").map((u) => ({ userId: u.id })) },
      boqItems: {
        create: BOQ.map(([itemNo, description, unit, quantity, rate, cc], i) => ({
          itemNo,
          description,
          unit,
          quantity,
          rate,
          sortOrder: i,
          costCodeId: codes.get(cc),
        })),
      },
    },
  });
  await setupDemoCapital();
  await setupFinanceAndPlanning(project.id);
  await setupOperations(project.id);
  console.log(`تم إنشاء المشروع التجريبي ${project.code} بقيمة ${contractValue}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
