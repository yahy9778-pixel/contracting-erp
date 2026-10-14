import { fmtQty } from "@/lib/format";

type Defaults = {
  date?: string;
  weather?: string | null;
  notes?: string | null;
  issues?: string | null;
  manpower?: { trade: string; count: number }[];
  equipment?: { name: string; count: number; hours: number | null }[];
  progress?: Map<string, { quantity: number; location: string | null }>;
};

type Item = { id: string; itemNo: string; description: string; unit: string; quantity: number };

const ROWS = Array.from({ length: 8 }, (_, i) => i);

export function ReportForm({
  action,
  items,
  executed,
  defaults = {},
  dateEditable = true,
  submitLabel,
}: {
  action: (form: FormData) => Promise<void>;
  items: Item[];
  executed: Map<string, number>;
  defaults?: Defaults;
  dateEditable?: boolean;
  submitLabel: string;
}) {
  return (
    <form action={action} className="space-y-6">
      <div className="card grid gap-4 md:grid-cols-3">
        <div>
          <label>التاريخ</label>
          <input name="date" type="date" required defaultValue={defaults.date} disabled={!dateEditable} />
        </div>
        <div>
          <label>الطقس</label>
          <input name="weather" defaultValue={defaults.weather ?? ""} placeholder="مشمس، 34°" />
        </div>
        <div>
          <label>ملاحظات عامة</label>
          <input name="notes" defaultValue={defaults.notes ?? ""} />
        </div>
        <div className="md:col-span-3">
          <label>معوقات وطلبات (مواد، معدات، استفسارات للاستشاري)</label>
          <textarea name="issues" rows={3} defaultValue={defaults.issues ?? ""} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3">العمالة</h2>
          <div className="grid grid-cols-3 gap-2">
            <span className="col-span-2 text-xs text-slate-500">المهنة</span>
            <span className="text-xs text-slate-500">العدد</span>
            {ROWS.map((i) => (
              <div key={i} className="contents">
                <input className="col-span-2" name={`trade_${i}`} defaultValue={defaults.manpower?.[i]?.trade ?? ""} />
                <input name={`count_${i}`} type="number" min="0" defaultValue={defaults.manpower?.[i]?.count ?? ""} />
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 className="mb-3">المعدات</h2>
          <div className="grid grid-cols-4 gap-2">
            <span className="col-span-2 text-xs text-slate-500">المعدة</span>
            <span className="text-xs text-slate-500">العدد</span>
            <span className="text-xs text-slate-500">ساعات التشغيل</span>
            {ROWS.map((i) => (
              <div key={i} className="contents">
                <input className="col-span-2" name={`eq_${i}`} defaultValue={defaults.equipment?.[i]?.name ?? ""} />
                <input name={`eqcount_${i}`} type="number" min="0" defaultValue={defaults.equipment?.[i]?.count ?? ""} />
                <input name={`eqhours_${i}`} type="number" min="0" step="0.5" defaultValue={defaults.equipment?.[i]?.hours ?? ""} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <div className="p-5 pb-3">
          <h2>الكميات المنفذة اليوم</h2>
          <p className="text-sm text-slate-500">اترك الخانة فارغة للبنود التي لم يُعمل بها اليوم.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>البند</th>
              <th>الوصف</th>
              <th>الوحدة</th>
              <th>المتبقي من العقد</th>
              <th>كمية اليوم</th>
              <th>الموقع / المحور</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const d = defaults.progress?.get(i.id);
              return (
                <tr key={i.id}>
                  <td className="num font-semibold">{i.itemNo}</td>
                  <td>{i.description}</td>
                  <td>{i.unit}</td>
                  <td className="num text-slate-500">{fmtQty(i.quantity - (executed.get(i.id) ?? 0))}</td>
                  <td className="w-32">
                    <input name={`qty_${i.id}`} type="number" min="0" step="0.001" defaultValue={d?.quantity ?? ""} />
                  </td>
                  <td className="w-48">
                    <input name={`loc_${i.id}`} defaultValue={d?.location ?? ""} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button className="btn">{submitLabel}</button>
    </form>
  );
}
