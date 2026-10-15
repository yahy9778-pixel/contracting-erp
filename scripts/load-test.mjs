// اختبار أداء أساسي: عدد من المستخدمين المتزامنين يطلبون صفحات النظام لمدة محددة
// الاستخدام:
//   BASE_URL="https://erp.example.com" SMOKE_EMAIL="..." SMOKE_PASSWORD="..." npm run loadtest
// خيارات: USERS (افتراضي 20)، SECONDS (افتراضي 30)، PATHS (مفصولة بفاصلة)
// شغّله في وقت هادئ، ولا تشغّله على الخادم نفسه حتى لا يؤثر على القياس.

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const USERS = Number(process.env.USERS ?? 20);
const SECONDS = Number(process.env.SECONDS ?? 30);
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

let cookie = "";
if (EMAIL && PASSWORD) {
  const page = await (await fetch(BASE + "/login")).text();
  const form = new FormData();
  for (const m of page.matchAll(/<input[^>]*type="hidden"[^>]*name="(\$ACTION_[^"]+)"(?:[^>]*value="([^"]*)")?/g)) {
    form.append(m[1], m[2] ?? "");
  }
  form.append("email", EMAIL);
  form.append("password", PASSWORD);
  const res = await fetch(BASE + "/login", { method: "POST", body: form, redirect: "manual" });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("erp_session="));
  if (!set) throw new Error("فشل تسجيل الدخول");
  cookie = set.split(";")[0];
}

const PATHS = (process.env.PATHS ?? (cookie ? "/,/finance,/finance/journal,/stores,/hr,/api/health" : "/login,/api/health"))
  .split(",")
  .map((p) => p.trim());

const times = [];
const statuses = new Map();
let errors = 0;
const deadline = Date.now() + SECONDS * 1000;

async function worker(i) {
  let n = i;
  while (Date.now() < deadline) {
    const path = PATHS[n++ % PATHS.length];
    const started = performance.now();
    try {
      const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
      await res.arrayBuffer();
      times.push(performance.now() - started);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      if (res.status >= 400) errors++;
    } catch {
      errors++;
    }
  }
}

console.log(`${USERS} مستخدما متزامنا لمدة ${SECONDS} ثانية على ${BASE}`);
console.log(`الصفحات: ${PATHS.join("، ")}\n`);
await Promise.all(Array.from({ length: USERS }, (_, i) => worker(i)));

times.sort((a, b) => a - b);
const pct = (p) => (times.length ? times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))].toFixed(0) : "-");
const total = times.length + errors;
console.log(`الطلبات: ${total}  (${(times.length / SECONDS).toFixed(1)} طلب/ثانية)`);
console.log(`زمن الاستجابة: الوسيط ${pct(50)} ms، p95 ${pct(95)} ms، p99 ${pct(99)} ms، الأقصى ${pct(100)} ms`);
console.log(`الحالات: ${[...statuses].map(([s, c]) => `${s}×${c}`).join("، ")}`);
console.log(`الأخطاء: ${errors} (${total ? ((errors / total) * 100).toFixed(2) : 0}%)`);

// معيار القبول المبدئي لشركة بعشرات المستخدمين: p95 أقل من ثانية وأخطاء أقل من 1%
const p95 = Number(pct(95));
const pass = errors / Math.max(total, 1) < 0.01 && p95 < 1000;
console.log(pass ? "\n✓ ضمن المعيار (p95 < 1000ms، أخطاء < 1%)" : "\n✗ خارج المعيار (p95 < 1000ms، أخطاء < 1%)");
process.exit(pass ? 0 : 1);
