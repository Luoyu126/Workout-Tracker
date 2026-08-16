import { describe, expect, test } from "vitest";

import {
  normalizeAttendanceNote,
  normalizeUserId
} from "../src/features/attendance/validation";

describe("attendance input validation", () => {
  test("accepts valid UUID user ids and rejects invalid values", () => {
    expect(normalizeUserId(" 550e8400-e29b-41d4-a716-446655440000 ")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    );
    expect(normalizeUserId("not-a-uuid")).toBeNull();
    expect(normalizeUserId("")).toBeNull();
  });

  test("normalizes optional attendance notes", () => {
    expect(normalizeAttendanceNote("  late because traffic  ")).toBe("late because traffic");
    expect(normalizeAttendanceNote("   ")).toBeNull();
  });
});
