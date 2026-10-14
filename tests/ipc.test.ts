import { describe, expect, it } from "vitest";
import { billableQty, calculateIpc, capSubcontractQty } from "@/lib/ipc";

const terms = {
  contractValue: 1_000_000,
  retentionPct: 10,
  advanceAmount: 100_000,
  vatPct: 15,
  advanceRecoveredBefore: 0,
  previousGross: 0,
};

describe("calculateIpc", () => {
  it("computes the first certificate from executed quantities", () => {
    const res = calculateIpc(
      [
        { boqItemId: "a", rate: 100, contractQty: 1000, executedToDate: 500, previousQty: 0 },
        { boqItemId: "b", rate: 50, contractQty: 200, executedToDate: 0, previousQty: 0 },
      ],
      terms,
    );
    expect(res.lines).toHaveLength(1);
    expect(res.grossCumulative).toBe(50_000);
    expect(res.currentGross).toBe(50_000);
    expect(res.retention).toBe(5_000);
    expect(res.advanceRecovery).toBe(5_000); // 10% من قيمة العقد
    expect(res.vat).toBe(6_000); // 15% من 40,000
    expect(res.netPayable).toBe(46_000);
  });

  it("only bills the quantity added since the previous certificate", () => {
    const res = calculateIpc(
      [{ boqItemId: "a", rate: 100, contractQty: 1000, executedToDate: 800, previousQty: 500 }],
      { ...terms, previousGross: 50_000, advanceRecoveredBefore: 5_000 },
    );
    expect(res.lines[0].currentQty).toBe(300);
    expect(res.currentGross).toBe(30_000);
    expect(res.advanceRecovery).toBe(3_000);
  });

  it("never recovers more advance than remains", () => {
    const res = calculateIpc(
      [{ boqItemId: "a", rate: 100, contractQty: 10_000, executedToDate: 10_000, previousQty: 0 }],
      { ...terms, advanceRecoveredBefore: 95_000 },
    );
    expect(res.advanceRecovery).toBe(5_000);
  });

  it("flags quantities beyond the contract BOQ", () => {
    const res = calculateIpc(
      [{ boqItemId: "a", rate: 10, contractQty: 100, executedToDate: 120, previousQty: 0 }],
      terms,
    );
    expect(res.lines[0].overrun).toBe(true);
  });
});

describe("billableQty", () => {
  it("is limited by inspected quantity when inspection is required", () => {
    expect(billableQty(500, 300, true)).toBe(300);
    expect(billableQty(200, 300, true)).toBe(200);
  });
  it("uses reported quantity when inspection is not required", () => {
    expect(billableQty(500, 0, false)).toBe(500);
  });
});

describe("capSubcontractQty", () => {
  it("never pays the subcontractor more than we bill or than the subcontract", () => {
    expect(capSubcontractQty(400, 300, 1000)).toEqual({ quantity: 300, capped: true, cap: 300 });
    expect(capSubcontractQty(400, 900, 350)).toEqual({ quantity: 350, capped: true, cap: 350 });
    expect(capSubcontractQty(100, 300, 1000)).toEqual({ quantity: 100, capped: false, cap: 300 });
  });
});
