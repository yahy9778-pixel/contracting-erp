import { describe, expect, it } from "vitest";
import { parseBoqText } from "@/lib/boq-import";

describe("parseBoqText", () => {
  it("parses tab separated rows copied from Excel and skips the header", () => {
    const text = "رقم\tالوصف\tالوحدة\tالكمية\tالسعر\n1.01\tحفر\tم3\t1,200\t35\tD1\n1.02\tردم\tم3\t800\t28";
    const { rows, errors } = parseBoqText(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { itemNo: "1.01", description: "حفر", unit: "م3", quantity: 1200, rate: 35, costCode: "D1" },
      { itemNo: "1.02", description: "ردم", unit: "م3", quantity: 800, rate: 28, costCode: undefined },
    ]);
  });

  it("reports incomplete lines", () => {
    const { rows, errors } = parseBoqText("1.01\tحفر\tم3\tx\t35\n2.01\tخرسانة");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });
});
