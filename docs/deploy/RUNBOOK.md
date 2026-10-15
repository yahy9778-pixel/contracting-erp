# دليل العمليات والطوارئ

كل الأوامر تُنفذ على الخادم من مجلد `/opt/contracting-erp` بالمستخدم `deploy`.

## النظام لا يفتح

1. **هل الخادم يعمل؟** `ssh deploy@الخادم`. إن لم يستجب: أعد تشغيله من لوحة المزود.
2. **حالة الخدمات:** `docker compose ps`
   - خدمة متوقفة: `docker compose up -d`
   - `app` بحالة unhealthy: `docker compose logs --tail 200 app`
3. **رسائل شائعة في سجل التطبيق:**

| الرسالة | السبب | الحل |
| --- | --- | --- |
| `[env] خطأ: SESSION_SECRET ...` | المفتاح ناقص أو قصير أو تجريبي | صحّحه في `.env` ثم `docker compose up -d` |
| `Can't reach database server` | قاعدة البيانات متوقفة | `docker compose logs db` ثم `docker compose up -d db` |
| `migration ... failed` | هجرة فشلت أثناء الإقلاع | لا تحاول مرة أخرى عشوائيا. خذ نسخة، ثم راجع `docker compose exec db psql -U erp -c 'select migration_name, logs from _prisma_migrations where finished_at is null'` |
| `No space left on device` | القرص ممتلئ | `docker image prune -af` واحذف نسخا قديمة من `backups/` بعد التأكد من وجودها خارجيا |

4. **الشهادة:** إن ظهر تحذير أمان في المتصفح: `docker compose logs caddy | tail -50`. غالبا النطاق لا يشير للخادم أو المنفذ 80 مغلق.

## التراجع عن نشر سيئ

```bash
git log --oneline -5                 # حدد آخر إصدار سليم
git reset --hard <الإصدار-السليم>
docker compose up -d --build
```

إن كان النشر السيئ قد طبق هجرة غيّرت البيانات، فالتراجع بالكود وحده لا يكفي: استعد النسخة التي أخذها النشر قبل التحديث (أحدث ملف `erp-manual-*.dump`). ثم أصلح المشكلة في GitHub بـ Pull Request جديد، لأن النشر التلقائي التالي سيعيد `main` كما هو.

## استعادة قاعدة البيانات

```bash
ls -lh backups/                              # اختر النسخة
sh scripts/restore.sh backups/erp-20261015-020000.dump
```

السكربت يطلب كتابة "نعم"، ويأخذ نسخة من الوضع الحالي قبل الاستبدال، ويوقف التطبيق أثناء الاستعادة ثم يعيد تشغيله. بعدها: `npm run smoke` من جهازك.

إن كانت النسخة في التخزين الخارجي فقط: `rclone copy offsite:erp-backups/الملف.dump backups/`

## تمرين الاستعادة

شهريا، بدون لمس قاعدة التشغيل:

```bash
docker compose exec db createdb -U erp erp_drill
docker compose exec -T db pg_restore -U erp -d erp_drill --no-owner < "$(ls -t backups/erp-*.dump | head -1)"
docker compose exec db psql -U erp -d erp_drill -c 'select count(*) as users from "User"' -c 'select count(*) as projects from "Project"' -c 'select count(*) as entries from "JournalEntry"'
docker compose exec db dropdb -U erp erp_drill
```

الأعداد يجب أن تقارب ما في النظام الحي. سجّل تاريخ التمرين ونتيجته.

## الخادم ضاع بالكامل

1. أنشئ خادما جديدا ونفّذ الخطوات 2 إلى 5 من [دليل النشر](README.md) بنفس `.env` من مدير كلمات المرور.
2. انسخ آخر نسخة من التخزين الخارجي إلى `backups/` واستعدها بـ `scripts/restore.sh`.
3. حدّث سجل A في DNS إلى العنوان الجديد، وحدّث `DEPLOY_HOST` في GitHub.
4. `npm run smoke` على النطاق.

## تدوير الأسرار

**SESSION_SECRET** (عند الشك في تسريبه، وسنويا):
```bash
openssl rand -base64 48       # ضع الناتج في .env
docker compose up -d app       # كل المستخدمين سيُطلب منهم الدخول من جديد
```

**مفتاح Claude:** أنشئ مفتاحا جديدا في console.anthropic.com، ضعه في `.env`، `docker compose up -d app`، ثم احذف القديم من الموقع.

**كلمة مرور قاعدة البيانات:**
```bash
NEW=$(openssl rand -hex 24)
docker compose exec db psql -U erp -c "ALTER USER erp PASSWORD '$NEW'"
# ضع القيمة نفسها في POSTGRES_PASSWORD داخل .env
docker compose up -d
```

**مفتاح النشر SSH:** أنشئ مفتاحا جديدا كما في الخطوة 9 من دليل النشر، حدّث `DEPLOY_SSH_KEY`، واحذف السطر القديم من `~/.ssh/authorized_keys`.

## موظف نسي كلمة المرور

المالك يغيّرها من **الإدارة ← المستخدمون**. إن نسي المالك نفسه كلمة مروره:

```bash
docker compose exec app node -e "
const b=require('bcryptjs');const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
b.hash(process.argv[1],10).then(h=>db.user.update({where:{email:process.argv[2]},data:{passwordHash:h}})).then(()=>console.log('تم')).finally(()=>db.\$disconnect())
" 'كلمة-المرور-الجديدة' 'owner@company.com'
```

## حساب مقفل بعد محاولات دخول فاشلة

النظام يوقف الدخول مؤقتا بعد محاولات فاشلة متكررة لنفس البريد، ويُفتح وحده بعد انتهاء المدة. للفتح فورا:

```bash
docker compose exec db psql -U erp -c "delete from \"LoginAttempt\" where email = 'user@company.com'"
```

## الوكلاء الأذكياء لا يعملون

1. سجل التطبيق: `docker compose logs app | grep -i anthropic | tail`
2. تحقق في console.anthropic.com: المفتاح فعال، والرصيد كاف، وحد الإنفاق لم يُبلغ.
3. بقية النظام يعمل بدون الوكلاء، فلا داعي لإيقافه.

## جهات الاتصال

| الدور | الاسم | التواصل |
| --- | --- | --- |
| مسؤول الخادم | | |
| مالك النظام | | |
| مزود الخادم (الدعم) | | |
| مزود النطاق | | |
