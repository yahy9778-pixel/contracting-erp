// تحويل نص منسوخ من Excel إلى بنود جدول كميات
// كل سطر: رقم البند | الوصف | الوحدة | الكمية | سعر الوحدة | رمز التكلفة (اختياري)

export type BoqRow = { itemNo: string; description: string; unit: string; quantity: number; rate: number; costCode?: string };

const toNumber = (v: string) => Number(v.replace(/[,\s]/g, ""));

export function parseBoqText(text: string): { rows: BoqRow[]; errors: string[] } {
  const rows: BoqRow[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, idx) => {
      const parts = (line.includes("\t") ? line.split("\t") : line.split(/[;,]/)).map((p) => p.trim());
      if (parts.length < 5) {
        errors.push(`السطر ${idx + 1}: يحتاج 5 أعمدة على الأقل`);
        return;
      }
      const [itemNo, description, unit, q, r, costCode] = parts;
      const quantity = toNumber(q);
      const rate = toNumber(r);
      // نتجاهل سطر العناوين إن وُجد
      if (idx === 0 && !Number.isFinite(quantity) && !Number.isFinite(rate)) return;
      if (!itemNo || !description || !unit || !Number.isFinite(quantity) || !Number.isFinite(rate)) {
        errors.push(`السطر ${idx + 1}: بيانات غير مكتملة أو أرقام غير صحيحة`);
        return;
      }
      rows.push({ itemNo, description, unit, quantity, rate, costCode: costCode || undefined });
    });
  return { rows, errors };
}
