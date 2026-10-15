#!/bin/sh
# يعمل داخل حاوية backup: نسخة كاملة من قاعدة البيانات كل يوم الساعة 02:00 (UTC)
# ويحذف النسخ الأقدم من KEEP_DAYS يوما
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"

backup() {
  file="/backups/erp-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "[backup] تم: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "[backup] فشل النسخ الاحتياطي" >&2
  fi
  find /backups -name 'erp-*.dump' -mtime "+$KEEP_DAYS" -delete
}

backup
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) 02:00:00" +%s 2>/dev/null || echo 0)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  [ "$next" -le "$now" ] && next=$((now + 86400))
  sleep $((next - now))
  backup
done
