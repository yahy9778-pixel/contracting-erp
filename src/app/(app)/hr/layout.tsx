import { requirePagePermission } from "@/lib/auth";
import { SubTabs } from "@/components/sub-tabs";

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("hr.view");
  return (
    <>
      <h1 className="no-print mb-4">الموارد البشرية</h1>
      <SubTabs
        tabs={[
          { href: "/hr", label: "الموظفون والعمالة", exact: true },
          { href: "/hr/payroll", label: "مسيرات الرواتب" },
        ]}
      />
      {children}
    </>
  );
}
