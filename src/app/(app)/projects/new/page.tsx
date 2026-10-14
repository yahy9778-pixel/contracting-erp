import { requirePagePermission } from "@/lib/auth";
import { createProject } from "@/app/actions/projects";
import { Flash, PageHeader } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

export default async function NewProjectPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission("projects.manage");
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="مشروع جديد" sub="بيانات العقد الأساسية، ويمكن إضافة جدول الكميات في الخطوة التالية" />
      <Flash error={error} />
      <form action={createProject} className="card grid gap-4 md:grid-cols-2">
        <div>
          <label>رقم المشروع</label>
          <input name="code" required placeholder="PRJ-002" dir="ltr" />
        </div>
        <div>
          <label>اسم المشروع</label>
          <input name="name" required />
        </div>
        <div>
          <label>المالك (العميل)</label>
          <input name="client" required />
        </div>
        <div>
          <label>الاستشاري المشرف</label>
          <input name="consultant" />
        </div>
        <div>
          <label>الموقع</label>
          <input name="location" />
        </div>
        <div>
          <label>قيمة العقد</label>
          <input name="contractValue" type="number" step="0.01" min="0" required />
        </div>
        <div>
          <label>تاريخ البدء</label>
          <input name="startDate" type="date" />
        </div>
        <div>
          <label>تاريخ الانتهاء التعاقدي</label>
          <input name="endDate" type="date" />
        </div>
        <div>
          <label>الدفعة المقدمة (مبلغ)</label>
          <input name="advanceAmount" type="number" step="0.01" min="0" defaultValue="0" />
        </div>
        <div>
          <label>نسبة المحتجز %</label>
          <input name="retentionPct" type="number" step="0.01" min="0" max="100" defaultValue="10" />
        </div>
        <div>
          <label>نسبة الضريبة %</label>
          <input name="vatPct" type="number" step="0.01" min="0" max="100" defaultValue="15" />
        </div>
        <div className="md:col-span-2">
          <button className="btn">حفظ المشروع</button>
        </div>
      </form>
    </>
  );
}
