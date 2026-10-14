import { describe, expect, it } from "vitest";
import { calculateIpc } from "@/lib/ipc";

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
