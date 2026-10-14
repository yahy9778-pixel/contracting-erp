// مصفوفة الصلاحيات (RBAC): كل دور وما يحق له
export const ROLES = {
  OWNER: "المالك / الإدارة العليا",
  PROJECT_MANAGER: "مدير مشروع",
  SITE_ENGINEER: "مهندس موقع",
  CONTRACTS: "العقود والمستخلصات",
  FINANCE: "الإدارة المالية",
  PLANNING: "التخطيط وضبط التكاليف",
} as const;

export type Role = keyof typeof ROLES;

const MATRIX = {
  "users.manage": ["OWNER"],
  "projects.manage": ["OWNER"],
  "projects.viewAll": ["OWNER"],
  "boq.edit": ["OWNER", "CONTRACTS"],
  // رؤية الأسعار والقيم المالية (مهندس الموقع يرى الكميات فقط)
  "money.view": ["OWNER", "PROJECT_MANAGER", "CONTRACTS", "FINANCE", "PLANNING"],
  "report.create": ["OWNER", "PROJECT_MANAGER", "SITE_ENGINEER"],
  "report.approve": ["OWNER", "PROJECT_MANAGER"],
  "ipc.create": ["OWNER", "CONTRACTS"],
  "ipc.submit": ["OWNER", "CONTRACTS"],
  "ipc.approve": ["OWNER", "CONTRACTS"],
  "ipc.markPaid": ["OWNER", "FINANCE"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: string, permission: Permission): boolean {
  return (MATRIX[permission] as readonly string[]).includes(role);
}

export function roleLabel(role: string): string {
  return ROLES[role as Role] ?? role;
}
