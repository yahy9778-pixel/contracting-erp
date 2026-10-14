import { describe, expect, it } from "vitest";
import { daysSince, ltifr } from "@/lib/safety";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("safety KPIs", () => {
  it("computes LTIFR per million man-hours", () => {
    expect(ltifr(2, 400_000)).toBe(5);
    expect(ltifr(0, 0)).toBeNull();
  });
  it("counts days since the last lost-time injury, or since project start", () => {
    expect(daysSince([d("2026-10-01"), d("2026-10-10")], d("2026-10-14"), d("2026-09-01"))).toBe(4);
    expect(daysSince([], d("2026-10-14"), d("2026-09-01"))).toBe(43);
  });
});
