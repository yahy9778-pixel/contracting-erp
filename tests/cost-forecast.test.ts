import { describe, expect, it } from "vitest";
import { forecastCostCode } from "@/lib/cost-forecast";

describe("forecastCostCode", () => {
  it("projects the remaining work when spending runs ahead of progress", () => {
    // سيناريو الأعمال الترابية: صُرف 128,000 والإنجاز 25% من قيمة البنود
    const f = forecastCostCode({ budget: 110208, committed: 128000, actual: 128000, contractValue: 134400, executedValue: 33600 });
    expect(f.pctComplete).toBe(25);
    expect(f.earned).toBe(27552);
    expect(f.forecast).toBe(210656); // 128,000 + 75% من الموازنة
    expect(f.forecastAtCurrentRate).toBe(512000);
    expect(f.cpi).toBeCloseTo(0.22, 2);
    expect(f.overBudget).toBe(true);
    expect(f.variance).toBe(-100448);
    expect(f.margin).toBe(134400 - 210656);
  });

  it("keeps the budget as the forecast for work not yet started", () => {
    const f = forecastCostCode({ budget: 50000, committed: 20000, actual: 0, contractValue: 60000, executedValue: 0 });
    expect(f.forecast).toBe(50000);
    expect(f.overBudget).toBe(false);
    expect(f.forecastAtCurrentRate).toBeNull();
  });

  it("uses the actual cost once the work is complete", () => {
    const f = forecastCostCode({ budget: 50000, committed: 45000, actual: 45000, contractValue: 60000, executedValue: 60000 });
    expect(f.forecast).toBe(45000);
    expect(f.marginPct).toBe(25);
  });

  it("does not let committed cost fall below the forecast", () => {
    const f = forecastCostCode({ budget: 100000, committed: 140000, actual: 10000, contractValue: 120000, executedValue: 60000 });
    expect(f.forecast).toBe(140000);
  });

  it("flags spending on a code with no budget as over budget", () => {
    const f = forecastCostCode({ budget: 0, committed: 5760, actual: 5760, contractValue: 0, executedValue: 0 });
    expect(f.noBudget).toBe(true);
    expect(f.overBudget).toBe(true);
    expect(f.pctComplete).toBeNull();
    expect(f.margin).toBeNull();
  });
});
