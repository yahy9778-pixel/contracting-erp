import { fmtPct } from "@/lib/format";

type Point = { date: Date; planned: number; actual: number | null };

// منحنى S: المخطط التراكمي مقابل الفعلي التراكمي
export function SCurve({ points, today }: { points: Point[]; today: Date }) {
  if (points.length < 2) return null;
  const W = 760;
  const H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 36 };
  const t0 = points[0].date.getTime();
  const t1 = points[points.length - 1].date.getTime();
  const x = (d: Date) => pad.l + ((d.getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const path = (pts: { date: Date; v: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const planned = path(points.map((p) => ({ date: p.date, v: p.planned })));
  const actualPts = points.filter((p) => p.actual !== null).map((p) => ({ date: p.date, v: p.actual! }));
  const actual = actualPts.length ? path(actualPts) : "";
  const labelEvery = Math.ceil(points.length / 8);
  const showToday = today.getTime() >= t0 && today.getTime() <= t1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ direction: "ltr" }} role="img" aria-label="منحنى S للمخطط والفعلي">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
          <text x={pad.l - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="#64748b">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={i} x={x(p.date)} y={H - 12} fontSize="10" textAnchor={i === points.length - 1 ? "end" : i === 0 ? "start" : "middle"} fill="#64748b">
            {p.date.toISOString().slice(0, 7)}
          </text>
        ) : null,
      )}
      {showToday && (
        <g>
          <line x1={x(today)} x2={x(today)} y1={pad.t} y2={H - pad.b} stroke="#94a3b8" strokeDasharray="4 3" />
          <text x={x(today) + 4} y={pad.t + 10} fontSize="10" fill="#475569">
            اليوم
          </text>
        </g>
      )}
      <path d={planned} fill="none" stroke="#1f6f5c" strokeWidth="2.5" />
      {actual && <path d={actual} fill="none" stroke="#d97706" strokeWidth="2.5" />}
      {actualPts.length > 0 && (
        <circle cx={x(actualPts[actualPts.length - 1].date)} cy={y(actualPts[actualPts.length - 1].v)} r="4" fill="#d97706">
          <title>{fmtPct(actualPts[actualPts.length - 1].v)}</title>
        </circle>
      )}
      <g fontSize="11">
        <rect x={W - pad.r - 150} y={H - pad.b - 22} width="12" height="3" fill="#1f6f5c" />
        <text x={W - pad.r - 134} y={H - pad.b - 17} fill="#334155">
          المخطط
        </text>
        <rect x={W - pad.r - 70} y={H - pad.b - 22} width="12" height="3" fill="#d97706" />
        <text x={W - pad.r - 54} y={H - pad.b - 17} fill="#334155">
          الفعلي
        </text>
      </g>
    </svg>
  );
}
