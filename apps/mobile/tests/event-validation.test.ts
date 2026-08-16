import { describe, expect, test } from "vitest";

import {
  isSignupOpen,
  isValidMatchScoreResult,
  isValidEventSchedule,
  parseIsoDateTime,
  parseMatchMinute,
  parseNonNegativeInteger,
  parseOptionalIsoDateTime,
  parseOptionalNonNegativeInteger
} from "../src/features/events/validation";

describe("event input validation", () => {
  test("normalizes valid ISO date-time input and rejects invalid values", () => {
    expect(parseIsoDateTime("2026-08-16T12:30:00.000Z")).toBe("2026-08-16T12:30:00.000Z");
    expect(parseIsoDateTime("2026-08-16T12:30Z")).toBe("2026-08-16T12:30:00.000Z");
    expect(parseIsoDateTime(" 2026-08-16T12:30:00-04:00 ")).toBe("2026-08-16T16:30:00.000Z");
    expect(parseIsoDateTime("")).toBeNull();
    expect(parseIsoDateTime("2026-08-16")).toBeNull();
    expect(parseIsoDateTime("2026-08-16 12:30")).toBeNull();
    expect(parseIsoDateTime("08/16/2026")).toBeNull();
    expect(parseIsoDateTime("123")).toBeNull();
    expect(parseIsoDateTime("周末下午三点")).toBeNull();
  });

  test("allows blank optional date-time input", () => {
    expect(parseOptionalIsoDateTime("")).toBeNull();
    expect(parseOptionalIsoDateTime("  ")).toBeNull();
    expect(parseOptionalIsoDateTime("2026-08-16T12:30:00.000Z")).toBe("2026-08-16T12:30:00.000Z");
  });

  test("validates event schedule ordering", () => {
    expect(
      isValidEventSchedule(
        "2026-08-16T12:00:00.000Z",
        "2026-08-16T14:00:00.000Z",
        "2026-08-16T12:00:00.000Z"
      )
    ).toBe(true);
    expect(isValidEventSchedule("2026-08-16T12:00:00.000Z", null, null)).toBe(true);
    expect(isValidEventSchedule("2026-08-16T12:00:00.000Z", "2026-08-16T11:59:00.000Z", null)).toBe(false);
    expect(isValidEventSchedule("2026-08-16T12:00:00.000Z", "2026-08-16T12:00:00.000Z", null)).toBe(false);
    expect(isValidEventSchedule("2026-08-16T12:00:00.000Z", null, "2026-08-16T12:01:00.000Z")).toBe(false);
  });

  test("allows signup until the deadline and closes it afterwards", () => {
    const now = new Date("2026-08-16T12:00:00.000Z");

    expect(isSignupOpen(null, "2026-08-16T12:00:00.000Z", now)).toBe(true);
    expect(isSignupOpen(null, "2026-08-16T12:00:01.000Z", now)).toBe(true);
    expect(isSignupOpen(null, "2026-08-16T11:59:59.999Z", now)).toBe(false);
    expect(isSignupOpen("2026-08-16T12:00:00.000Z", "2026-08-17T12:00:00.000Z", now)).toBe(true);
    expect(isSignupOpen("2026-08-16T12:00:01.000Z", "2026-08-17T12:00:00.000Z", now)).toBe(true);
    expect(isSignupOpen("2026-08-16T11:59:59.999Z", "2026-08-17T12:00:00.000Z", now)).toBe(false);
    expect(isSignupOpen("not-a-date", "2026-08-17T12:00:00.000Z", now)).toBe(false);
    expect(isSignupOpen(null, "not-a-date", now)).toBe(false);
  });

  test("accepts only strict non-negative integer scores", () => {
    expect(parseNonNegativeInteger("0")).toBe(0);
    expect(parseNonNegativeInteger("12")).toBe(12);
    expect(parseNonNegativeInteger("2abc")).toBeNull();
    expect(parseNonNegativeInteger("-1")).toBeNull();
    expect(parseNonNegativeInteger("1.5")).toBeNull();
  });

  test("accepts only strict non-negative integer match minutes", () => {
    expect(parseMatchMinute("0")).toBe(0);
    expect(parseMatchMinute(" 90 ")).toBe(90);
    expect(parseMatchMinute("-1")).toBeNull();
    expect(parseMatchMinute("45+2")).toBeNull();
    expect(parseMatchMinute("12.5")).toBeNull();
    expect(parseMatchMinute("")).toBeNull();
  });

  test("allows blank optional score input", () => {
    expect(parseOptionalNonNegativeInteger("")).toBeNull();
    expect(parseOptionalNonNegativeInteger("  ")).toBeNull();
    expect(parseOptionalNonNegativeInteger("3")).toBe(3);
  });

  test("requires match scores to be paired and result to match the score", () => {
    expect(isValidMatchScoreResult(null, null, null)).toBe(true);
    expect(isValidMatchScoreResult(2, 1, "win")).toBe(true);
    expect(isValidMatchScoreResult(1, 2, "loss")).toBe(true);
    expect(isValidMatchScoreResult(1, 1, "draw")).toBe(true);
    expect(isValidMatchScoreResult(2, null, null)).toBe(false);
    expect(isValidMatchScoreResult(null, 2, null)).toBe(false);
    expect(isValidMatchScoreResult(null, null, "draw")).toBe(false);
    expect(isValidMatchScoreResult(2, 1, "loss")).toBe(false);
  });
});
