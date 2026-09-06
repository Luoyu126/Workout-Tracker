import { describe, expect, test } from "vitest";

import { beijingIso, beijingParts, dateLabel, daysInMonth, halfHourOptions, timeLabel } from "../src/lib/datetime/beijing";

describe("Beijing date/time input", () => {
  test("uses Beijing midnight across UTC and year boundaries", () => {
    const parts = beijingParts("2026-12-31T16:15:00Z");
    expect(parts).not.toBeNull();
    if (!parts) throw new Error("Expected date");
    expect(dateLabel(parts)).toBe("2027-01-01");
    expect(timeLabel(parts)).toBe("00:15");
    expect(beijingIso(parts)).toBe("2026-12-31T16:15:00.000Z");
  });

  test("round-trips legacy minutes, seconds and milliseconds without rounding", () => {
    const value = "2026-09-06T10:15:23.123Z";
    const parts = beijingParts(value);
    if (!parts) throw new Error("Expected date");
    expect(timeLabel(parts)).toBe("18:15:23.123");
    expect(beijingIso(parts)).toBe(value);
    expect(beijingIso({ ...parts, day: 7 })).toBe("2026-09-07T10:15:23.123Z");
  });

  test("always uses UTC+08:00, including device daylight-saving dates", () => {
    expect(beijingParts("2026-03-08T07:30:00Z")?.hour).toBe(15);
    expect(beijingParts("2026-11-01T06:30:00Z")?.hour).toBe(14);
  });

  test("offers all 48 half-hour slots, without 24:00", () => {
    expect(halfHourOptions).toHaveLength(48);
    expect(halfHourOptions[0].label).toBe("00:00");
    expect(halfHourOptions[47].label).toBe("23:30");
    expect(new Set(halfHourOptions.map((option) => option.label)).size).toBe(48);
    expect(halfHourOptions.every(({ minute }) => minute === 0 || minute === 30)).toBe(true);
  });

  test("handles leap years, month lengths and empty input", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(beijingParts("")).toBeNull();
    expect(beijingParts("invalid")).toBeNull();
  });
});
