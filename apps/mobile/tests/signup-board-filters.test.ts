import { describe, expect, test } from "vitest";

import { signupBoardDateRange, toggleSignupBoardEventType } from "../src/features/teams/signupBoardFilters";

describe("signup board calendar filters", () => {
  test("all time has no date restriction", () => {
    expect(signupBoardDateRange("all")).toEqual({});
  });

  test("Sunday belongs to the week beginning on the previous Monday", () => {
    expect(signupBoardDateRange("week", new Date(2026, 8, 6, 12))).toEqual({
      startsAfter: new Date(2026, 7, 31).toISOString(),
      startsBefore: new Date(2026, 8, 6, 23, 59, 59, 999).toISOString()
    });
  });

  test("Monday starts a new week, including across the year boundary", () => {
    expect(signupBoardDateRange("week", new Date(2025, 11, 29, 8))).toEqual({
      startsAfter: new Date(2025, 11, 29).toISOString(),
      startsBefore: new Date(2026, 0, 4, 23, 59, 59, 999).toISOString()
    });
  });

  test("month includes leap day and excludes the next month", () => {
    expect(signupBoardDateRange("month", new Date(2028, 1, 15, 12))).toEqual({
      startsAfter: new Date(2028, 1, 1).toISOString(),
      startsBefore: new Date(2028, 1, 29, 23, 59, 59, 999).toISOString()
    });
  });

  test("uses local midnights across daylight-saving changes", () => {
    expect(signupBoardDateRange("week", new Date(2026, 2, 8, 12))).toEqual({
      startsAfter: new Date(2026, 2, 2).toISOString(),
      startsBefore: new Date(2026, 2, 8, 23, 59, 59, 999).toISOString()
    });
  });

  test("types can be selected independently or together but never both removed", () => {
    expect(toggleSignupBoardEventType(["training", "match"], "training")).toEqual(["match"]);
    expect(toggleSignupBoardEventType(["match"], "match")).toEqual(["match"]);
    expect(toggleSignupBoardEventType(["match"], "training")).toEqual(["training", "match"]);
    expect(toggleSignupBoardEventType(["training", "match"], "match")).toEqual(["training"]);
    expect(toggleSignupBoardEventType(["training"], "training")).toEqual(["training"]);
  });
});
