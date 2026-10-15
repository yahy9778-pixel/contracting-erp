# دليل النشر والتشغيل الفعلي

هذا الدليل ينقل النظام من جهازك إلى خادم حقيقي يعمل على نطاقك بشهادة HTTPS، مع قاعدة PostgreSQL ونسخ احتياطي يومي ونشر تلقائي من GitHub.

ملفات مرتبطة:
- [قائمة التحقق قبل الإطلاق](CHECKLIST.md)
- [خطة الصيانة المستمرة](MAINTENANCE.md)
- [دليل العمليات والطوارئ](RUNBOOK.md)

## الصورة العامة

```
المستخدم ──HTTPS──▶ Caddy (شهادة تلقائية) ──▶ التطبيق Next.js ──▶ PostgreSQL 16
                                                                     │
                                                    backup: نسخة يومية 02:00 UTC ──▶ ./backups ──▶ تخزين خارجي
```

كل ذلك على خادم Linux واحد عبر Docker Compose (`docker-compose.yml`). قاعدة البيانات لا تُفتح للإنترنت، والمنفذان الوحيدان المفتوحان هما 80 و443.

## 1. اختيار منصة الإطلاق

**التوصية: خادم افتراضي (VPS) بـ Docker Compose.** السبب: النظام يحتاج اتصالا دائما بقاعدة البيانات، ووكلاء Claude قد تستغرق طلباتهم دقيقة أو أكثر، والملفات هنا تعمل كما هي على أي خادم Linux بدون تعديل.

| الخيار | المناسب له | ملاحظات |
| --- | --- | --- |
| **VPS (DigitalOcean، Hetzner، Vultr، أو سحابة محلية)** ✅ | هذا النظام | تحكم كامل وتكلفة ثابتة. الحجم المقترح للبداية: 2 معالج، 4 GB ذاكرة، 60 GB قرص (تقريبا 20 إلى 25 دولارا شهريا) |
| Railway / Render | من لا يريد إدارة خادم | أسهل، لكن PostgreSQL والنسخ الاحتياطي فيها بإعدادات المنصة، والتكلفة تزيد مع الاستخدام |
| Vercel | غير مناسب حاليا | دوال قصيرة العمر تقطع طلبات الوكلاء الطويلة، وتحتاج قاعدة خارجية مع تجميع اتصالات |

> **ملاحظة على مكان البيانات:** النظام يحفظ بيانات موظفين ورواتب وعقود. إن كان نظام حماية البيانات الشخصية (PDPL) يلزمكم بإبقاء البيانات داخل المملكة، اختر مزود سحابة بمركز بيانات في السعودية. الخطوات أدناه نفسها على أي مزود.

## 2. تجهيز الخادم (مرة واحدة)

أنشئ خادما بنظام **Ubuntu 24.04 LTS** وأضف مفتاح SSH عند إنشائه، ثم ادخل عليه:

```bash
ssh root@عنوان-الخادم
```

### 2.1 مستخدم للنشر وتحديثات الأمان

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy

apt update && apt upgrade -y
apt install -y unattended-upgrades fail2ban git
dpkg-reconfigure -plow unattended-upgrades   # اختر Yes
```

### 2.2 إغلاق الدخول بكلمة المرور ودخول root

في الملف `/etc/ssh/sshd_config` تأكد من:

```
PasswordAuthentication no
PermitRootLogin no
```

ثم `systemctl restart ssh`. **قبل أن تغلق الجلسة** افتح نافذة جديدة وتأكد أن `ssh deploy@عنوان-الخادم` يعمل.

### 2.3 الجدار الناري

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

### 2.4 تثبيت Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

اخرج وادخل من جديد بالمستخدم `deploy`.

## 3. النطاق (DNS)

من لوحة مزود النطاق أضف سجلا:

| النوع | الاسم | القيمة |
| --- | --- | --- |
| A | `erp` (أو أي اسم فرعي) | عنوان IP الخادم |

النتيجة مثلا `erp.company.com`. تحقق قبل المتابعة: `ping erp.company.com` يجب أن يعيد عنوان الخادم. الشهادة لن تصدر حتى يصل النطاق للخادم.

## 4. تنزيل النظام وضبط الأسرار

```bash
sudo mkdir -p /opt/contracting-erp && sudo chown deploy:deploy /opt/contracting-erp
git clone https://github.com/yahy9778-pixel/contracting-erp.git /opt/contracting-erp
cd /opt/contracting-erp
cp .env.production.example .env
chmod 600 .env
```

> المستودع خاص: استخدم [Deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) للقراءة فقط بدل كلمة مرورك. أنشئ مفتاحا على الخادم بـ `ssh-keygen -t ed25519 -f ~/.ssh/github`، وأضف `~/.ssh/github.pub` في GitHub ← Settings ← Deploy keys، ثم استخدم رابط SSH للمستودع.

### توليد الأسرار

```bash
echo "POSTGRES_PASSWORD: $(openssl rand -hex 24)"
echo "SESSION_SECRET:    $(openssl rand -base64 48)"
```

افتح `.env` بـ `nano .env` وضع:

| المتغير | القيمة |
| --- | --- |
| `DOMAIN` | النطاق، مثل `erp.company.com` |
| `ACME_EMAIL` | بريدك لإشعارات الشهادة |
| `POSTGRES_PASSWORD` | الناتج الأول أعلاه |
| `SESSION_SECRET` | الناتج الثاني أعلاه (32 حرفا على الأقل، والنظام يرفض الإقلاع بقيمة أقصر أو بالقيمة التجريبية) |
| `ANTHROPIC_API_KEY` | مفتاح من [console.anthropic.com](https://console.anthropic.com) ← API Keys. أنشئ مفتاحا خاصا بهذا الخادم وضع له حد إنفاق شهري من Billing ← Limits |

قواعد الأسرار:
- ملف `.env` لا يُرفع إلى GitHub أبدا (مستبعد في `.gitignore`)، وصلاحيته `600`.
- لا تُرسل المفاتيح في واتساب أو البريد. احفظ نسخة منها في مدير كلمات مرور (1Password، Bitwarden).
- مفتاح مختلف لكل بيئة: مفتاح جهازك غير مفتاح الخادم.

## 5. التشغيل الأول

```bash
docker compose up -d --build
docker compose ps          # كل الخدمات Up، والتطبيق (healthy)
docker compose logs -f app # اخرج بـ Ctrl+C
```

عند الإقلاع يطبق التطبيق هجرات قاعدة البيانات تلقائيا، ويطبع تنبيها إن كان مفتاح Claude غير مضبوط.

## 6. البيانات: بداية نظيفة أو نقل من SQLite

اختر **واحدا** فقط:

### أ. بداية نظيفة (الأغلب)

ينشئ رموز التكلفة ودليل الحسابات وحساب المالك فقط، بدون أي بيانات تجريبية:

```bash
docker compose exec -e ADMIN_EMAIL="you@company.com" -e ADMIN_NAME="اسمك" -e ADMIN_PASSWORD="كلمة-مرور-قوية-12-حرفا-على-الأقل" \
  app node_modules/.bin/tsx prisma/bootstrap.ts
```

ادخل بالحساب، ثم أضف المستخدمين من **الإدارة ← المستخدمون**.

> لا تشغّل `npm run db:seed` على الخادم: ينشئ حسابات تجريبية بكلمة مرور معروفة.

### ب. نقل بيانات من نسخة SQLite سابقة

إن كنتم أدخلتم بيانات حقيقية في نسخة التجربة (`prisma/dev.db`):

```bash
# من جهازك: انسخ الملف إلى الخادم
scp prisma/dev.db deploy@عنوان-الخادم:/opt/contracting-erp/import.db

# على الخادم، وقاعدة PostgreSQL ما زالت فارغة (قبل الخطوة أ)
docker compose run --rm --no-deps -v ./import.db:/import.db:ro app \
  node_modules/.bin/tsx scripts/migrate-sqlite-to-postgres.ts /import.db
rm import.db
```

السكربت ينقل كل الجداول في معاملة واحدة (إما كلها أو لا شيء)، ويرفض العمل إن كانت قاعدة PostgreSQL فيها بيانات، ثم يطابق عدد السجلات في كل جدول مع المصدر. بعد النقل غيّر كلمات مرور الحسابات التجريبية أو عطّلها من شاشة المستخدمين.

## 7. اختبار التشغيل

من جهازك (يحتاج Node.js 22) أنشئ حسابا للفحص بدور المالك، ثم:

```bash
BASE_URL="https://erp.company.com" SMOKE_EMAIL="..." SMOKE_PASSWORD="..." npm run smoke
```

يفحص: صحة التطبيق وقاعدة البيانات، تحويل HTTP إلى HTTPS، ترويسات الأمان، تسجيل الدخول، وفتح صفحات كل الأقسام. النتيجة المطلوبة: كل البنود ✓.

### اختبار الأداء الأساسي

```bash
BASE_URL="https://erp.company.com" SMOKE_EMAIL="..." SMOKE_PASSWORD="..." USERS=20 SECONDS=30 npm run loadtest
```

يحاكي 20 مستخدما متزامنين. المعيار: زمن الاستجابة p95 أقل من ثانية، والأخطاء أقل من 1%. شغّله في وقت هادئ.
مرجع: على خادم تجريبي بـ 4 معالجات مع البيانات التجريبية كانت النتيجة 40 طلبا في الثانية، الوسيط 477ms، وp95 778ms، بلا أخطاء.

## 8. النسخ الاحتياطي

خدمة `backup` في Docker Compose تأخذ نسخة كاملة من قاعدة البيانات عند الإقلاع ثم يوميا الساعة 02:00 UTC (05:00 بتوقيت الرياض) في `/opt/contracting-erp/backups`، وتحذف ما هو أقدم من `BACKUP_KEEP_DAYS` (14 يوما افتراضيا).

**النسخة على الخادم نفسه لا تكفي**: إن تعطل الخادم ضاعت معه. انسخها يوميا إلى تخزين خارجي (DigitalOcean Spaces، Backblaze B2، أو Amazon S3):

```bash
sudo apt install -y rclone
rclone config            # أضف وجهة باسم offsite حسب مزودك
crontab -e
# أضف السطر:
30 2 * * * rclone copy /opt/contracting-erp/backups offsite:erp-backups --max-age 48h >> /home/deploy/rclone.log 2>&1
```

فعّل في التخزين الخارجي حذفا تلقائيا للملفات الأقدم من 90 يوما.

نسخة فورية (قبل أي عمل حساس): `sh scripts/backup-now.sh`
الاستعادة: راجع [دليل العمليات](RUNBOOK.md#استعادة-قاعدة-البيانات).

## 9. النشر التلقائي (CI/CD)

في المستودع ملفان:
- `.github/workflows/ci.yml`: مع كل Pull Request وكل دفع إلى `main`: فحص الأنواع، الاختبارات، التأكد أن النموذج مطابق للهجرات، البناء، تشغيل النظام على PostgreSQL حقيقية مع اختبار التشغيل، وبناء صورة Docker.
- `.github/workflows/deploy.yml`: بعد نجاح CI على `main` يدخل على الخادم، يأخذ نسخة احتياطية، يحدّث النظام، ينتظر جاهزيته، ثم يشغّل اختبار التشغيل على النطاق.

النشر التلقائي **معطل** حتى تضبطه. للتفعيل:

1. على الخادم أنشئ مفتاحا خاصا بالنشر:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/gh_deploy -N ""
   cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys
   cat ~/.ssh/gh_deploy      # انسخ المحتوى للخطوة التالية ثم احذف الملف
   rm ~/.ssh/gh_deploy
   ```
2. في GitHub ← المستودع ← Settings ← Environments أنشئ بيئة باسم `production` (ويمكنك أن تشترط موافقتك على كل نشر من Required reviewers).
3. في Settings ← Secrets and variables ← Actions أضف:

   | النوع | الاسم | القيمة |
   | --- | --- | --- |
   | Secret | `DEPLOY_HOST` | عنوان الخادم |
   | Secret | `DEPLOY_USER` | `deploy` |
   | Secret | `DEPLOY_SSH_KEY` | المفتاح الخاص من الخطوة 1 |
   | Secret | `SMOKE_EMAIL` / `SMOKE_PASSWORD` | حساب الفحص |
   | Variable | `DOMAIN` | `erp.company.com` |
   | Variable | `DEPLOY_ENABLED` | `true` |
   | Variable | `DEPLOY_PATH` | `/opt/contracting-erp` (اختياري) |

4. في Settings ← Branches أضف حماية لفرع `main`: يشترط نجاح CI قبل الدمج.

بعدها: كل دمج في `main` يُنشر وحده. ويمكنك النشر يدويا من تبويب Actions ← Deploy ← Run workflow.

## 10. التحديث اليدوي (بدون CI/CD)

```bash
cd /opt/contracting-erp
sh scripts/backup-now.sh
git pull
docker compose up -d --build
docker compose ps
```

الهجرات الجديدة تُطبق تلقائيا عند إقلاع التطبيق.

## ملخص الأوامر

| المهمة | الأمر |
| --- | --- |
| حالة الخدمات | `docker compose ps` |
| سجلات التطبيق | `docker compose logs -f --tail 200 app` |
| إعادة تشغيل التطبيق | `docker compose restart app` |
| نسخة احتياطية الآن | `sh scripts/backup-now.sh` |
| استعادة نسخة | `sh scripts/restore.sh backups/الملف.dump` |
| فحص الصحة | `curl https://erp.company.com/api/health` |
| الدخول لقاعدة البيانات | `docker compose exec db psql -U erp` |
