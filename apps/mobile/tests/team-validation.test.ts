import { describe, expect, test } from "vitest";

import {
  normalizeMemberUserId,
  normalizeOptionalTeamText,
  normalizeTeamName
} from "../src/features/teams/validation";

describe("team input validation", () => {
  test("normalizes required team names", () => {
    expect(normalizeTeamName("  Demo FC  ")).toBe("Demo FC");
    expect(normalizeTeamName("   ")).toBeNull();
  });

  test("normalizes optional team text fields", () => {
    expect(normalizeOptionalTeamText("  Forward  ")).toBe("Forward");
    expect(normalizeOptionalTeamText("")).toBeNull();
    expect(normalizeOptionalTeamText("   ")).toBeNull();
  });

  test("validates member user ids as UUIDs", () => {
    expect(normalizeMemberUserId(" 550e8400-e29b-41d4-a716-446655440000 ")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
    expect(normalizeMemberUserId("user-1")).toBeNull();
  });
});
