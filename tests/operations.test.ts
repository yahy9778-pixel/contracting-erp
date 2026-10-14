import { describe, expect, it } from "vitest";
import { averageCost, payrollApprovalLines, payrollLine, serviceStatus, stockBalance } from "@/lib/operations";
import { ACC, normalizeLines } from "@/lib/ledger";

describe("stock", () => {
  it("uses the weighted average cost of all moves", () => {
    const moves = [
      { quantity: 10, value: 1000 },
      { quantity: 30, value: 3600 },
      { quantity: -5, value: -575 },
    ];
    expect(averageCost(moves)).toBeCloseTo(115);
    expect(stockBalance(moves)).toBe(35);
    expect(averageCost([])).toBe(0);
  });
});

describe("payrollLine", () => {
  it("prorates salary by days and pays overtime at 1.5x the hourly basic", () => {
    const l = payrollLine({ basicSalary: 2400, allowances: 600, daysWorked: 15, overtimeHours: 10, deductions: 100 });
    expect(l.basic).toBe(1200);
    expect(l.allowances).toBe(300);
    expect(l.overtimePay).toBe(150); // 2400 / 240 = 10 للساعة × 1.5 × 10
    expect(l.net).toBe(1550);
  });
  it("rejects deductions larger than earnings and invalid days", () => {
    expect(() => payrollLine({ basicSalary: 1000, allowances: 0, daysWorked: 1, overtimeHours: 0, deductions: 500 })).toThrow();
    expect(() => payrollLine({ basicSalary: 1000, allowances: 0, daysWorked: 31, overtimeHours: 0, deductions: 0 })).toThrow();
  });
});

describe("payrollApprovalLines", () => {
  it("charges site staff to project labour and head office to admin, and balances", () => {
    const lines = normalizeLines(
      payrollApprovalLines(
        [
          { projectId: "p1", net: 5000 },
          { projectId: "p1", net: 3000 },
          { projectId: null, net: 9000 },
        ],
        "L1",
      ),
    );
    expect(lines.find((l) => l.account === ACC.LABOR)).toMatchObject({ debit: 8000, projectId: "p1", costCodeId: "L1" });
    expect(lines.find((l) => l.account === ACC.ADMIN)?.debit).toBe(9000);
    expect(lines.find((l) => l.account === ACC.SALARIES_PAYABLE)?.credit).toBe(17000);
  });
});

describe("serviceStatus", () => {
  it("flags equipment past its service interval", () => {
    expect(serviceStatus(1180, 950, 250)).toEqual({ due: false, remaining: 20 });
    expect(serviceStatus(1210, 950, 250)).toEqual({ due: true, remaining: -10 });
    expect(serviceStatus(100, 0, null).due).toBe(false);
  });
});
