import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ProjectTabs } from "./tabs";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, project } = await requireProjectAccess(id);
  const tabs = [
    { href: "", label: "نظرة عامة" },
    { href: "/boq", label: "جدول الكميات" },
    { href: "/reports", label: "التقارير اليومية" },
    { href: "/quality", label: "الجودة" },
    { href: "/technical", label: "المكتب الفني" },
    { href: "/procurement", label: "المشتريات" },
    ...(can(user.role, "money.view")
      ? [
          { href: "/subcontracts", label: "مقاولو الباطن" },
          { href: "/ipcs", label: "مستخلصات المالك" },
        ]
      : []),
  ];
  return (
    <>
      <div className="no-print mb-2 text-sm text-slate-500">
        {project.code} · {project.client.name}
      </div>
      <h1 className="no-print mb-4">{project.name}</h1>
      <ProjectTabs id={id} tabs={tabs} />
      {children}
    </>
  );
}
