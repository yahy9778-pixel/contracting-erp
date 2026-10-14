import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDate, fmtQty, isOverdue, todayStr } from "@/lib/format";
import { INCIDENT_KINDS, OBS_CATEGORIES, SEVERITY_LABELS } from "@/lib/safety";
import { safetyStats } from "@/lib/safety-service";
import { closeIncident, closeObservation, createObservation, recordTalk, reportIncident } from "@/app/actions/safety";
import { Flash, Stat, StatusBadge } from "@/components/ui";
import type { SearchParams } from "@/lib/flash";

const SEV_STYLE: Record<string, string> = { HIGH: "bg-red-100 text-red-800", MEDIUM: "bg-amber-100 text-amber-800", LOW: "bg-slate-100 text-slate-700" };

export default async function SafetyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const { user } = await requireProjectAccess(id);
  const [stats, incidents, observations, talks] = await Promise.all([
    safetyStats(id),
    db.safetyIncident.findMany({ where: { projectId: id }, orderBy: [{ status: "desc" }, { number: "desc" }] }),
    db.safetyObservation.findMany({ where: { projectId: id }, orderBy: [{ status: "desc" }, { dueDate: "asc" }] }),
    db.toolboxTalk.findMany({ where: { projectId: id }, orderBy: { date: "desc" }, take: 10 }),
  ]);
  const canReport = can(user.role, "hse.report");
  const canManage = can(user.role, "hse.manage");

  return (
    <div className="space-y-8">
      <Flash error={error} notice={notice} />
      <div className="grid gap-4 md:grid-cols-5">
        <Stat label="أيام بدون إصابة مضيعة للوقت" value={<span className="num text-emerald-700">{stats.daysWithoutLti}</span>} />
        <Stat label="ساعات العمل" value={<span className="num">{fmtQty(stats.manHours)}</span>} hint="من العمالة في التقارير المعتمدة × 8" />
        <Stat
          label="LTIFR"
          value={<span className="num">{stats.ltifr === null ? "—" : stats.ltifr.toFixed(2)}</span>}
          hint={`${stats.lti} إصابة مضيعة للوقت لكل مليون ساعة`}
        />
        <Stat label="ملاحظات مفتوحة" value={<span className={`num ${stats.overdueObs ? "text-red-700" : ""}`}>{stats.openObs}</span>} hint={stats.overdueObs ? `${stats.overdueObs} تجاوزت موعد التصحيح` : undefined} />
        <Stat label="أحاديث السلامة" value={<span className="num">{stats.talks}</span>} hint={`${stats.talkAttendees} حضور · ${stats.nearMisses} حادث وشيك مُبلّغ`} />
      </div>

      <section className="space-y-3">
        <h2>ملاحظات التفتيش</h2>
        {canReport && (
          <form action={createObservation.bind(null, id)} className="card grid gap-3 md:grid-cols-6">
            <select name="category" required defaultValue="">
              <option value="" disabled>
                الفئة
              </option>
              {Object.entries(OBS_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select name="severity" defaultValue="MEDIUM">
              <option value="HIGH">خطورة عالية (يوم)</option>
              <option value="MEDIUM">متوسطة (3 أيام)</option>
              <option value="LOW">منخفضة (7 أيام)</option>
            </select>
            <input name="description" placeholder="الملاحظة" required className="md:col-span-2" />
            <input name="assignedTo" placeholder="المسؤول عن التصحيح" required />
            <button className="btn">تسجيل</button>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>الفئة</th>
                <th>الخطورة</th>
                <th>الملاحظة</th>
                <th>المسؤول</th>
                <th>موعد التصحيح</th>
                <th>الحالة / الإغلاق</th>
              </tr>
            </thead>
            <tbody>
              {observations.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500">
                    لا توجد ملاحظات.
                  </td>
                </tr>
              )}
              {observations.map((o) => (
                <tr key={o.id}>
                  <td className="num">OBS-{o.number}</td>
                  <td>{OBS_CATEGORIES[o.category] ?? o.category}</td>
                  <td>
                    <span className={`badge ${SEV_STYLE[o.severity]}`}>{SEVERITY_LABELS[o.severity]}</span>
                  </td>
                  <td>{o.description}</td>
                  <td>{o.assignedTo}</td>
                  <td className={`num ${o.status === "OPEN" && isOverdue(o.dueDate) ? "font-semibold text-red-700" : ""}`}>{fmtDate(o.dueDate)}</td>
                  <td className="min-w-64">
                    {o.status === "OPEN" && canManage ? (
                      <form action={closeObservation.bind(null, id, o.id)} className="flex gap-2">
                        <input name="closureNote" placeholder="ما الذي صُحح؟" required />
                        <button className="btn-secondary whitespace-nowrap">إغلاق</button>
                      </form>
                    ) : o.status === "OPEN" ? (
                      <StatusBadge status="OPEN" />
                    ) : (
                      <span className="text-sm">{o.closureNote}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2>الحوادث</h2>
        {canReport && (
          <form action={reportIncident.bind(null, id)} className="card grid gap-3 md:grid-cols-6">
            <select name="kind" required defaultValue="">
              <option value="" disabled>
                النوع
              </option>
              {Object.entries(INCIDENT_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input name="date" type="date" defaultValue={todayStr()} />
            <input name="location" placeholder="الموقع" />
            <input name="injured" placeholder="المصاب (إن وجد)" />
            <input name="lostDays" type="number" min="0" step="1" placeholder="أيام الغياب" />
            <input name="description" placeholder="ماذا حدث؟" required className="md:col-span-5" />
            <button className="btn">إبلاغ</button>
          </form>
        )}
        <div className="card overflow-x-auto p-0">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>الوصف</th>
                <th>الحالة</th>
                <th>التحقيق</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500">
                    لا توجد حوادث مسجلة.
                  </td>
                </tr>
              )}
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td className="num">INC-{i.number}</td>
                  <td className="num">{fmtDate(i.date)}</td>
                  <td>
                    {INCIDENT_KINDS[i.kind] ?? i.kind}
                    {i.lostDays > 0 && <div className="text-xs text-red-700">{i.lostDays} يوم غياب</div>}
                  </td>
                  <td>
                    {i.description}
                    <div className="text-xs text-slate-500">{[i.location, i.injured].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="min-w-96">
                    {i.status === "OPEN" && canManage ? (
                      <form action={closeIncident.bind(null, id, i.id)} className="grid gap-2">
                        <input name="rootCause" placeholder="السبب الجذري" required />
                        <div className="flex gap-2">
                          <input name="correctiveAction" placeholder="الإجراء التصحيحي لمنع التكرار" required />
                          <button className="btn-secondary whitespace-nowrap">إغلاق</button>
                        </div>
                      </form>
                    ) : (
                      <span className="text-sm">{i.rootCause ? `${i.rootCause} ← ${i.correctiveAction}` : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2>أحاديث السلامة (Toolbox talks)</h2>
        {canReport && (
          <form action={recordTalk.bind(null, id)} className="card flex flex-wrap items-end gap-3">
            <input name="date" type="date" defaultValue={todayStr()} className="w-auto" />
            <input name="topic" placeholder="الموضوع" required className="flex-1" />
            <input name="attendees" type="number" min="1" placeholder="الحضور" required className="w-28" />
            <button className="btn">تسجيل</button>
          </form>
        )}
        {talks.length > 0 && (
          <ul className="card space-y-1 text-sm">
            {talks.map((t) => (
              <li key={t.id}>
                <span className="num">{fmtDate(t.date)}</span> · {t.topic} · <span className="num">{t.attendees}</span> حاضر
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
