// حساب مستخلص المالك (IPC) من الكميات المنفذة المعتمدة
// دالة نقية بلا قاعدة بيانات حتى يسهل اختبارها

export type IpcBoqInput = {
  boqItemId: string;
  rate: number;
  contractQty: number;
  // الكمية التراكمية المنفذة والمعتمدة حتى نهاية الفترة
  executedToDate: number;
  // الكمية التراكمية في المستخلص السابق
  previousQty: number;
};

export type IpcTerms = {
  contractValue: number;
  retentionPct: number; // 10 تعني 10%
  advanceAmount: number;
  vatPct: number;
  // إجمالي الدفعة المقدمة المسترد في المستخلصات السابقة
  advanceRecoveredBefore: number;
  previousGross: number;
};

export type IpcLineResult = {
  boqItemId: string;
  previousQty: number;
  currentQty: number;
  cumulativeQty: number;
  rate: number;
  overrun: boolean;
};

export type IpcResult = {
  lines: IpcLineResult[];
  grossCumulative: number;
  previousGross: number;
  currentGross: number;
  retention: number;
  advanceRecovery: number;
  vat: number;
  netPayable: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calculateIpc(items: IpcBoqInput[], terms: IpcTerms): IpcResult {
  const lines = items
    .map((i) => {
      const cumulativeQty = Math.max(i.executedToDate, i.previousQty);
      return {
        boqItemId: i.boqItemId,
        previousQty: i.previousQty,
        currentQty: cumulativeQty - i.previousQty,
        cumulativeQty,
        rate: i.rate,
        overrun: cumulativeQty > i.contractQty + 1e-9,
      };
    })
    .filter((l) => l.cumulativeQty > 0);

  const grossCumulative = r2(lines.reduce((s, l) => s + l.cumulativeQty * l.rate, 0));
  const currentGross = r2(grossCumulative - terms.previousGross);
  const retention = r2((currentGross * terms.retentionPct) / 100);

  // الدفعة المقدمة تسترد بنسبتها من قيمة العقد، ولا يتجاوز الاسترداد رصيدها المتبقي
  const advanceRatio = terms.contractValue > 0 ? terms.advanceAmount / terms.contractValue : 0;
  const advanceRemaining = Math.max(0, terms.advanceAmount - terms.advanceRecoveredBefore);
  const advanceRecovery = r2(Math.min(Math.max(0, currentGross * advanceRatio), advanceRemaining));

  const taxable = currentGross - retention - advanceRecovery;
  const vat = r2((taxable * terms.vatPct) / 100);
  const netPayable = r2(taxable + vat);

  return { lines, grossCumulative, previousGross: terms.previousGross, currentGross, retention, advanceRecovery, vat, netPayable };
}

// الكمية القابلة للفوترة لبند: المنفذ المعتمد في التقارير اليومية،
// وإذا كان المشروع يشترط الاستلام فلا تتجاوز ما استلمه الاستشاري
export function billableQty(reported: number, inspected: number, requireInspection: boolean): number {
  return requireInspection ? Math.min(reported, inspected) : reported;
}

// مستخلص الباطن: لا ندفع لمقاول الباطن كمية أكبر مما نستخلصه نحن من المالك
export function capSubcontractQty(requested: number, billableToUs: number, subcontractQty: number) {
  const cap = Math.min(billableToUs, subcontractQty);
  return { quantity: Math.min(Math.max(0, requested), cap), capped: requested > cap + 1e-9, cap };
}
