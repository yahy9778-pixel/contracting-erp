#!/bin/sh
# استعادة قاعدة البيانات من نسخة احتياطية. يحذف البيانات الحالية ويستبدلها بالنسخة.
#   sh scripts/restore.sh backups/erp-20261015-020000.dump
set -eu
file="${1:?حدد ملف النسخة، مثال: sh scripts/restore.sh backups/erp-20261015-020000.dump}"
[ -f "$file" ] || { echo "الملف غير موجود: $file" >&2; exit 1; }

echo "سيتم استبدال كل بيانات النظام الحالية بمحتوى $file"
printf "اكتب نعم للمتابعة: "
read -r answer
[ "$answer" = "نعم" ] || { echo "أُلغيت الاستعادة"; exit 1; }

# نسخة أمان من الوضع الحالي قبل الاستبدال
sh "$(dirname "$0")/backup-now.sh"

docker compose stop app
docker compose exec -T db pg_restore -U erp -d erp --clean --if-exists --no-owner --single-transaction < "$file"
docker compose start app
echo "تمت الاستعادة. شغّل اختبار التشغيل: BASE_URL=https://\$DOMAIN npm run smoke"
