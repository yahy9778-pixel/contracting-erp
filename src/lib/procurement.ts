// منطق المشتريات (دوال نقية مختبرة)

export type QuoteInput = { id: string; lines: { prLineId: string; unitPrice: number }[] };
export type PrLineInput = { id: string; quantity: number };

// مقارنة العروض: إجمالي كل عرض، والعرض الأقل سعرا بين العروض المكتملة (المسعرة لكل البنود)
export function compareQuotes(prLines: PrLineInput[], quotes: QuoteInput[]) {
  const totals = quotes.map((q) => {
    const prices = new Map(q.lines.map((l) => [l.prLineId, l.unitPrice]));
    const complete = prLines.every((l) => prices.has(l.id));
    const total = prLines.reduce((s, l) => s + l.quantity * (prices.get(l.id) ?? 0), 0);
    return { id: q.id, total: Math.round(total * 100) / 100, complete };
  });
  const lowest = totals.filter((t) => t.complete).sort((a, b) => a.total - b.total)[0]?.id ?? null;
  return { totals, lowest };
}

// حالة أمر الشراء بعد الاستلام
export function receiptStatus(lines: { ordered: number; received: number }[]): "ISSUED" | "PARTIAL" | "RECEIVED" {
  const any = lines.some((l) => l.received > 0);
  const all = lines.every((l) => l.received >= l.ordered - 1e-9);
  return all ? "RECEIVED" : any ? "PARTIAL" : "ISSUED";
}

// أمر الشراء فوق الحد يحتاج اعتماد الإدارة العليا
export function initialPoStatus(total: number, limit: number) {
  return total > limit ? "PENDING_APPROVAL" : "ISSUED";
}
