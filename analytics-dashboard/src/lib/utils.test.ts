import { describe, it, expect } from "vitest";
import { formatUsd, formatPct, formatNumber, cn } from "@/lib/utils";

describe("utils", () => {
  it("formats USD", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(null)).toBe("—");
  });

  it("formats percent", () => {
    expect(formatPct(5.2)).toBe("+5.20%");
    expect(formatPct(-1)).toBe("-1.00%");
  });

  it("formats number", () => {
    expect(formatNumber(1.234, 1)).toBe("1.2");
  });

  it("merges class names", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
