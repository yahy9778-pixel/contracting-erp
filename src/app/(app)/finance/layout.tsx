import { requirePagePermission } from "@/lib/auth";
import { SubTabs } from "@/components/sub-tabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("finance.view");
  return (
    <>
      <h1 className="no-print mb-4">الإدارة المالية</h1>
      <SubTabs
        tabs={[
          { href: "/finance", label: "ميزان المراجعة", exact: true },
          { href: "/finance/journal", label: "قيود اليومية" },
          { href: "/finance/payments", label: "السندات والأرصدة" },
          { href: "/finance/guarantees", label: "خطابات الضمان" },
        ]}
      />
      {children}
    </>
  );
}
