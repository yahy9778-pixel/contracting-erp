import { describe, expect, it } from "vitest";
import { ACC, costAccountFor, ipcApprovalLines, normalizeLines, subCertApprovalLines } from "@/lib/ledger";

const sum = (lines: { debit: number; credit: number }[]) => [lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0)];

describe("normalizeLines", () => {
  it("rejects an unbalanced entry", () => {
    expect(() => normalizeLines([{ account: ACC.BANK, debit: 100 }, { account: ACC.CAPITAL, credit: 90 }])).toThrow();
  });
  it("drops zero lines and turns negative debits into credits", () => {
    const out = normalizeLines([
      { account: ACC.BANK, debit: 100 },
      { account: ACC.VAT_IN, debit: 0 },
      { account: ACC.REVENUE, debit: -100 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ account: ACC.REVENUE, debit: 0, credit: 100 });
  });
});

describe("ipcApprovalLines", () => {
  // نفس أرقام اختبار المستخلص: إجمالي 50,000، محتجز 5,000، استرداد 5,000، ضريبة 6,000، صافي 46,000
  const ipc = { currentGross: 50_000, retention: 5_000, advanceRecovery: 5_000, vat: 6_000, netPayable: 46_000, approvedAmount: null, clientId: "c" };

  it("balances and recognises the gross value as revenue", () => {
    const lines = normalizeLines(ipcApprovalLines(ipc));
    const [d, c] = sum(lines);
    expect(d).toBe(c);
    expect(lines.find((l) => l.account === ACC.REVENUE)?.credit).toBe(50_000);
    expect(lines.find((l) => l.account === ACC.AR)?.debit).toBe(46_000);
  });

  it("books a consultant cut against revenue and still balances", () => {
    const lines = normalizeLines(ipcApprovalLines({ ...ipc, approvedAmount: 45_000 }));
    const [d, c] = sum(lines);
    expect(d).toBe(c);
    expect(lines.find((l) => l.account === ACC.AR)?.debit).toBe(45_000);
    expect(lines.find((l) => l.account === ACC.REVENUE)?.credit).toBe(49_000);
  });
});

describe("subCertApprovalLines", () => {
  it("splits cost by cost code and balances (المثال المختبر في المتصفح: 45 م3 × 700)", () => {
    const lines = normalizeLines(
      subCertApprovalLines({ lines: [{ amount: 31_500, costCodeId: "d3" }], retention: 3_150, vat: 4_252.5, netPayable: 32_602.5, partyId: "s" }),
    );
    const [d, c] = sum(lines);
    expect(d).toBe(c);
    expect(lines.find((l) => l.account === ACC.AP_SUB)?.credit).toBe(32_602.5);
    expect(lines.find((l) => l.account === ACC.SUBCONTRACT)?.costCodeId).toBe("d3");
  });
});

describe("costAccountFor", () => {
  it("maps cost codes to cost accounts", () => {
    expect(costAccountFor("D3")).toBe(ACC.SUBCONTRACT);
    expect(costAccountFor("E1")).toBe(ACC.MATERIALS);
    expect(costAccountFor("E3")).toBe(ACC.EQUIPMENT);
    expect(costAccountFor("F1")).toBe(ACC.TEMP_WORKS);
    expect(costAccountFor("L1")).toBe(ACC.LABOR);
    expect(costAccountFor(null)).toBe(ACC.SITE_OH);
  });
});
