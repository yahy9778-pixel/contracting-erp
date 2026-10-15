#!/bin/sh
# نسخة احتياطية فورية (مثلا قبل تحديث النظام). تُشغل من مجلد المشروع على الخادم:
#   sh scripts/backup-now.sh
set -eu
mkdir -p backups
file="backups/erp-manual-$(date -u +%Y%m%d-%H%M%S).dump"
trap 'rm -f "$file.tmp"' EXIT
docker compose exec -T db pg_dump -U erp -d erp -Fc > "$file.tmp"
mv "$file.tmp" "$file"
echo "تم: $file ($(du -h "$file" | cut -f1))"
