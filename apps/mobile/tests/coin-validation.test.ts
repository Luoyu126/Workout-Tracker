import { describe, expect, test } from "vitest";

import {
  normalizeCoinReason,
  normalizeCoinTargetUserId,
  parseCoinAmount,
  parseCoinRuleAmount,
  parseManualCoinAmount,
  selectEffectiveCoinRule
} from "../src/features/coins/validation";

describe("coin input validation", () => {
  test("parses strict integer coin amounts", () => {
    expect(parseCoinAmount(" 10 ")).toBe(10);
    expect(parseCoinAmount("-5")).toBe(-5);
    expect(parseCoinAmount("1.5")).toBeNull();
    expect(parseCoinAmount("2abc")).toBeNull();
  });

  test("allows non-negative rule amounts", () => {
    expect(parseCoinRuleAmount("0")).toBe(0);
    expect(parseCoinRuleAmount("10")).toBe(10);
    expect(parseCoinRuleAmount("-1")).toBeNull();
  });

  test("requires non-zero manual adjustment amounts", () => {
    expect(parseManualCoinAmount("10")).toBe(10);
    expect(parseManualCoinAmount("-10")).toBe(-10);
    expect(parseManualCoinAmount("0")).toBeNull();
  });

  test("normalizes target user id and reason", () => {
    expect(normalizeCoinTargetUserId(" 550e8400-e29b-41d4-a716-446655440000 ")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
    expect(normalizeCoinTargetUserId("user-1")).toBeNull();
    expect(normalizeCoinReason("  纪律扣分  ")).toBe("纪律扣分");
    expect(normalizeCoinReason("  ")).toBeNull();
  });

  test("selects the same effective active signup rule the backend uses for rewards", () => {
    const olderActiveRule = {
      id: "older",
      trigger_type: "training_signup" as const,
      amount: 10,
      is_active: true,
      updated_at: "2026-08-10T10:00:00.000Z",
      created_at: "2026-08-10T10:00:00.000Z"
    };
    const newerInactiveRule = {
      id: "inactive",
      trigger_type: "training_signup" as const,
      amount: 99,
      is_active: false,
      updated_at: "2026-08-12T10:00:00.000Z",
      created_at: "2026-08-12T10:00:00.000Z"
    };
    const newerActiveRule = {
      id: "newer",
      trigger_type: "training_signup" as const,
      amount: 17,
      is_active: true,
      updated_at: "2026-08-11T10:00:00.000Z",
      created_at: "2026-08-11T10:00:00.000Z"
    };

    expect(selectEffectiveCoinRule([olderActiveRule, newerInactiveRule, newerActiveRule], "training_signup")).toBe(
      newerActiveRule
    );
    expect(selectEffectiveCoinRule([newerInactiveRule], "training_signup")).toBeNull();
  });
});
