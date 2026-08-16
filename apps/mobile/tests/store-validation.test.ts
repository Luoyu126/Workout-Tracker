import { describe, expect, test } from "vitest";

import {
  parseRedemptionQuantity,
  parseStoreNumbers,
  parseStrictInteger
} from "../src/features/store/validation";

describe("store input validation", () => {
  test("parses only strict integers", () => {
    expect(parseStrictInteger(" 12 ")).toBe(12);
    expect(parseStrictInteger("-2")).toBe(-2);
    expect(parseStrictInteger("2abc")).toBeNull();
    expect(parseStrictInteger("1.5")).toBeNull();
    expect(parseStrictInteger("")).toBeNull();
  });

  test("validates item price and optional stock", () => {
    expect(parseStoreNumbers("50", "10")).toEqual({ price: 50, stock: 10 });
    expect(parseStoreNumbers("50", "")).toEqual({ price: 50, stock: null });
    expect(parseStoreNumbers("0", "10")).toBeNull();
    expect(parseStoreNumbers("50", "-1")).toBeNull();
    expect(parseStoreNumbers("50abc", "10")).toBeNull();
  });

  test("validates redemption quantity without silently coercing invalid input", () => {
    expect(parseRedemptionQuantity("1")).toBe(1);
    expect(parseRedemptionQuantity(" 3 ")).toBe(3);
    expect(parseRedemptionQuantity("0")).toBeNull();
    expect(parseRedemptionQuantity("-1")).toBeNull();
    expect(parseRedemptionQuantity("2abc")).toBeNull();
  });
});
