// مصفوفة الصلاحيات (RBAC): كل دور وما يحق له
export const ROLES = {
  OWNER: "المالك / الإدارة العليا",
  PROJECT_MANAGER: "مدير مشروع",
  SITE_ENGINEER: "مهندس موقع",
  CONTRACTS: "العقود والمستخلصات",
  FINANCE: "الإدارة المالية",
  PLANNING: "التخطيط وضبط التكاليف",
  QUALITY: "الجودة QA/QC",
  TECHNICAL: "المكتب الفني",
  PROCUREMENT: "المشتريات ومقاولو الباطن",
} as const;

export type Role = keyof typeof ROLES;

const MATRIX = {
  "users.manage": ["OWNER"],
  "projects.manage": ["OWNER"],
  "projects.viewAll": ["OWNER"],
  "boq.edit": ["OWNER", "CONTRACTS"],
  // رؤية الأسعار والقيم المالية (مهندس الموقع يرى الكميات فقط)
  "money.view": ["OWNER", "PROJECT_MANAGER", "CONTRACTS", "FINANCE", "PLANNING", "PROCUREMENT"],
  "report.create": ["OWNER", "PROJECT_MANAGER", "SITE_ENGINEER"],
  "report.approve": ["OWNER", "PROJECT_MANAGER"],
  "ipc.create": ["OWNER", "CONTRACTS"],
  "ipc.submit": ["OWNER", "CONTRACTS"],
  "ipc.approve": ["OWNER", "CONTRACTS"],
  "ipc.markPaid": ["OWNER", "FINANCE"],
  // الجودة
  "ir.create": ["OWNER", "PROJECT_MANAGER", "SITE_ENGINEER", "QUALITY"],
  "ir.record": ["OWNER", "PROJECT_MANAGER", "QUALITY"],
  "ncr.manage": ["OWNER", "PROJECT_MANAGER", "QUALITY"],
  // المكتب الفني
  "tech.manage": ["OWNER", "PROJECT_MANAGER", "TECHNICAL"],
  // المشتريات
  "pr.create": ["OWNER", "PROJECT_MANAGER", "SITE_ENGINEER", "TECHNICAL", "PROCUREMENT"],
  "pr.approve": ["OWNER", "PROJECT_MANAGER"],
  "po.manage": ["OWNER", "PROCUREMENT"],
  // أوامر الشراء فوق حد الصلاحية تحتاج الإدارة العليا
  "po.approveHigh": ["OWNER"],
  "grn.create": ["OWNER", "PROCUREMENT", "SITE_ENGINEER"],
  // مقاولو الباطن
  "sub.manage": ["OWNER", "PROCUREMENT", "CONTRACTS"],
  "sub.approve": ["OWNER", "PROJECT_MANAGER"],
  "sub.markPaid": ["OWNER", "FINANCE"],
  // المالية والمحاسبة
  "finance.view": ["OWNER", "FINANCE"],
  "finance.post": ["OWNER", "FINANCE"],
  "expense.create": ["OWNER", "FINANCE", "PROJECT_MANAGER"],
  "guarantee.manage": ["OWNER", "FINANCE", "CONTRACTS"],
  // التخطيط وضبط التكاليف
  "budget.edit": ["OWNER", "PLANNING"],
  "schedule.edit": ["OWNER", "PLANNING", "PROJECT_MANAGER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: string, permission: Permission): boolean {
  return (MATRIX[permission] as readonly string[]).includes(role);
}

export function roleLabel(role: string): string {
  return ROLES[role as Role] ?? role;
}

// حد صلاحية أمر الشراء: ما فوقه يحتاج اعتماد الإدارة العليا
export const PO_APPROVAL_LIMIT = Number(process.env.PO_APPROVAL_LIMIT ?? 50_000);
