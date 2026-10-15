// اختبار سريع بعد كل نشر: هل النظام يعمل على الخادم كما يجب؟
// الاستخدام:
//   BASE_URL="https://erp.example.com" SMOKE_EMAIL="..." SMOKE_PASSWORD="..." npm run smoke
// بدون البريد وكلمة المرور تُفحص الصفحات العامة فقط.
// يُفضل حساب مخصص للفحص بصلاحية المالك حتى تُفحص كل الصفحات.

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - started, error: e.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let cookie = "";
const get = (path, opts = {}) =>
  fetch(BASE + path, { redirect: "manual", ...opts, headers: { ...(cookie ? { cookie } : {}), ...opts.headers } });

// تسجيل الدخول عبر نموذج الصفحة نفسه (بدون JavaScript) كما يفعل المتصفح
async function login() {
  const page = await (await get("/login")).text();
  const form = new FormData();
  for (const m of page.matchAll(/<input[^>]*type="hidden"[^>]*name="(\$ACTION_[^"]+)"(?:[^>]*value="([^"]*)")?/g)) {
    form.append(m[1], m[2] ?? "");
  }
  assert([...form.keys()].length, "لم أجد حقول إجراء تسجيل الدخول في صفحة /login");
  form.append("email", EMAIL);
  form.append("password", PASSWORD);
  const res = await fetch(BASE + "/login", { method: "POST", body: form, redirect: "manual" });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("erp_session="));
  assert(set, `فشل تسجيل الدخول (الحالة ${res.status}). تحقق من البريد وكلمة المرور`);
  cookie = set.split(";")[0];
}

await check("فحص الصحة /api/health وقاعدة البيانات", async () => {
  const res = await get("/api/health");
  const body = await res.json();
  assert(res.status === 200 && body.db === "ok", `الحالة ${res.status}: ${JSON.stringify(body)}`);
});

await check("صفحة الدخول تعمل", async () => {
  const res = await get("/login");
  assert(res.status === 200, `الحالة ${res.status}`);
});

await check("الصفحات المحمية تحول غير المسجل إلى الدخول", async () => {
  const res = await get("/");
  assert([302, 303, 307, 308].includes(res.status), `الحالة ${res.status}`);
  assert(res.headers.get("location")?.includes("/login"), `التحويل إلى ${res.headers.get("location")}`);
});

await check("ترويسات الأمان موجودة", async () => {
  const res = await get("/login");
  for (const h of ["x-frame-options", "x-content-type-options", "referrer-policy"]) {
    assert(res.headers.get(h), `الترويسة ${h} غير موجودة`);
  }
  assert(!res.headers.get("x-powered-by"), "الترويسة x-powered-by يجب ألا تظهر");
  if (BASE.startsWith("https://")) assert(res.headers.get("strict-transport-security"), "HSTS غير موجود");
});

if (BASE.startsWith("https://")) {
  await check("HTTP يتحول إلى HTTPS", async () => {
    const res = await fetch(BASE.replace("https://", "http://") + "/login", { redirect: "manual" });
    assert([301, 302, 307, 308].includes(res.status), `الحالة ${res.status}`);
    assert(res.headers.get("location")?.startsWith("https://"), `التحويل إلى ${res.headers.get("location")}`);
  });
}

if (EMAIL && PASSWORD) {
  await check("تسجيل الدخول", login);
  const pages = ["/", "/projects/new", "/finance", "/finance/journal", "/finance/payments", "/finance/guarantees", "/stores", "/hr", "/hr/payroll", "/equipment", "/admin/users", "/admin/audit", "/account"];
  for (const p of pages) {
    await check(`الصفحة ${p}`, async () => {
      assert(cookie, "لا توجد جلسة");
      const res = await get(p);
      assert(res.status === 200, `الحالة ${res.status}`);
    });
  }
} else {
  console.log("تنبيه: SMOKE_EMAIL وSMOKE_PASSWORD غير مضبوطين، تم فحص الصفحات العامة فقط\n");
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name} (${r.ms} ms)${r.ok ? "" : `\n    ${r.error}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ناجح`);
process.exit(failed ? 1 : 0);
