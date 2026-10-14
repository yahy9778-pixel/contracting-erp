// بيانات أولية: رموز التكلفة، مستخدمون تجريبيون، ومشروع تجريبي بجدول كميات
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const COST_CODES: [string, string, string][] = [
  ["D1", "أعمال ترابية", "مقاولو الباطن"],
  ["D2", "أعمال الخوازيق", "مقاولو الباطن"],
  ["D3", "أعمال الخرسانة", "مقاولو الباطن"],
  ["D4", "الهياكل المعدنية", "مقاولو الباطن"],
  ["D5", "التشطيبات", "مقاولو الباطن"],
  ["D6", "الأعمال الكهربائية", "مقاولو الباطن"],
  ["D7", "الأعمال الميكانيكية", "مقاولو الباطن"],
  ["D8", "التيار الخفيف", "مقاولو الباطن"],
  ["D9", "المرافق تحت الأرض", "مقاولو الباطن"],
  ["D10", "تنسيق الموقع", "مقاولو الباطن"],
  ["D11", "الديكور", "مقاولو الباطن"],
  ["E1", "المواد الخام", "الموردون"],
  ["E2", "الأدوات", "الموردون"],
  ["E3", "المعدات", "الموردون"],
  ["E4", "الإكسسوارات", "الموردون"],
  ["F1", "مواد الشدة", "الأعمال المؤقتة"],
  ["F2", "معدات النقل الأفقي", "الأعمال المؤقتة"],
  ["F3", "معدات النقل الرأسي", "الأعمال المؤقتة"],
  ["L1", "العمالة المباشرة", "العمالة"],
  ["G1", "المصاريف العامة للموقع", "مصاريف عامة"],
];

const USERS = [
  { name: "المالك", email: "owner@company.local", role: "OWNER" },
  { name: "مدير المشروع", email: "pm@company.local", role: "PROJECT_MANAGER" },
  { name: "مهندس الموقع", email: "site@company.local", role: "SITE_ENGINEER" },
  { name: "مهندس العقود", email: "contracts@company.local", role: "CONTRACTS" },
  { name: "المحاسب", email: "finance@company.local", role: "FINANCE" },
  { name: "مهندس الجودة", email: "qc@company.local", role: "QUALITY" },
  { name: "المكتب الفني", email: "technical@company.local", role: "TECHNICAL" },
  { name: "مسؤول المشتريات", email: "procurement@company.local", role: "PROCUREMENT" },
];

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
  for (const [code, name, group] of COST_CODES) {
    await db.costCode.upsert({ where: { code }, update: { name, group }, create: { code, name, group } });
  }

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
    console.log("المشروع التجريبي موجود مسبقا، تم تحديث أعضائه");
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
  console.log(`تم إنشاء المشروع التجريبي ${project.code} بقيمة ${contractValue}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
