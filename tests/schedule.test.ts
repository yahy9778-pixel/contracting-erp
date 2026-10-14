import { describe, expect, it } from "vitest";
import { activityStatus, cashflowForecast, monthEnds, plannedPct, scheduleSummary } from "@/lib/schedule";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("plannedPct", () => {
  it("is linear between start and end, inclusive of both days", () => {
    expect(plannedPct(d("2026-01-01"), d("2026-01-10"), d("2025-12-31"))).toBe(0);
    expect(plannedPct(d("2026-01-01"), d("2026-01-10"), d("2026-01-05"))).toBeCloseTo(0.5);
    expect(plannedPct(d("2026-01-01"), d("2026-01-10"), d("2026-01-10"))).toBe(1);
  });
});

describe("scheduleSummary", () => {
  it("weights activities and computes SPI", () => {
    const s = scheduleSummary(
      [
        { weight: 300, start: d("2026-01-01"), end: d("2026-01-10"), actualPct: 0.5 },
        { weight: 100, start: d("2026-02-01"), end: d("2026-02-10"), actualPct: 0 },
      ],
      d("2026-01-10"),
    );
    expect(s.planned).toBeCloseTo(0.75);
    expect(s.actual).toBeCloseTo(0.375);
    expect(s.spi).toBeCloseTo(0.5);
  });
});

describe("activityStatus", () => {
  it("classifies progress against plan", () => {
    const end = d("2026-03-01");
    expect(activityStatus(1, 1, end, d("2026-04-01"))).toBe("DONE");
    expect(activityStatus(1, 0.8, end, d("2026-04-01"))).toBe("LATE");
    expect(activityStatus(0.6, 0.4, end, d("2026-02-01"))).toBe("BEHIND");
    expect(activityStatus(0.6, 0.55, end, d("2026-02-01"))).toBe("ON_TRACK");
  });
});

describe("monthEnds", () => {
  it("lists month ends up to and including the end date", () => {
    expect(monthEnds(d("2026-09-01"), d("2026-11-15")).map((x) => x.toISOString().slice(0, 10))).toEqual(["2026-09-30", "2026-10-31", "2026-11-15"]);
  });
});

describe("cashflowForecast", () => {
  it("collects one month after the work and pays in the month of the work", () => {
    const rows = cashflowForecast({
      plannedValue: [100, 200, 300],
      lagMonths: 1,
      collectionFactor: 0.8,
      costRatio: 0.9,
      openReceivable: 50,
      openPayable: 20,
      openingCash: 1000,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].inflow).toBeCloseTo(100 * 0.8 + 50);
    expect(rows[0].outflow).toBeCloseTo(200 * 0.9 + 20);
    expect(rows[1].cumulative).toBeCloseTo(1000 + (130 - 200) + (160 - 270));
  });
});
