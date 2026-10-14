import { describe, expect, it } from "vitest";
import { compareQuotes, initialPoStatus, receiptStatus } from "@/lib/procurement";

describe("compareQuotes", () => {
  const lines = [
    { id: "l1", quantity: 10 },
    { id: "l2", quantity: 5 },
  ];
  it("picks the cheapest complete quotation", () => {
    const res = compareQuotes(lines, [
      { id: "a", lines: [{ prLineId: "l1", unitPrice: 100 }, { prLineId: "l2", unitPrice: 50 }] },
      { id: "b", lines: [{ prLineId: "l1", unitPrice: 90 }, { prLineId: "l2", unitPrice: 60 }] },
      { id: "c", lines: [{ prLineId: "l1", unitPrice: 10 }] },
    ]);
    expect(res.totals).toEqual([
      { id: "a", total: 1250, complete: true },
      { id: "b", total: 1200, complete: true },
      { id: "c", total: 100, complete: false },
    ]);
    expect(res.lowest).toBe("b");
  });
});

describe("receiptStatus", () => {
  it("tracks partial and full receipt", () => {
    expect(receiptStatus([{ ordered: 10, received: 0 }])).toBe("ISSUED");
    expect(receiptStatus([{ ordered: 10, received: 4 }, { ordered: 5, received: 0 }])).toBe("PARTIAL");
    expect(receiptStatus([{ ordered: 10, received: 10 }, { ordered: 5, received: 5 }])).toBe("RECEIVED");
  });
});

describe("initialPoStatus", () => {
  it("sends orders above the limit for approval", () => {
    expect(initialPoStatus(60_000, 50_000)).toBe("PENDING_APPROVAL");
    expect(initialPoStatus(50_000, 50_000)).toBe("ISSUED");
  });
});
