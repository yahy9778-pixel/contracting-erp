"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({ id, tabs }: { id: string; tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="no-print mb-6 flex gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const href = `/projects/${id}${t.href}`;
        const active = t.href === "" ? path === href : path.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
              active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
