import { describe, expect, test } from "vitest";

import { normalizeOptionalText, normalizeRequiredText, omitUndefined } from "../src/lib/validation/text";

describe("text validation", () => {
  test("trims required text and rejects blank input", () => {
    expect(normalizeRequiredText(" Player 9 ")).toBe("Player 9");
    expect(normalizeRequiredText("")).toBeNull();
    expect(normalizeRequiredText("   ")).toBeNull();
  });

  test("trims optional text and removes undefined fields from request bodies", () => {
    expect(normalizeOptionalText("  note  ")).toBe("note");
    expect(normalizeOptionalText("   ")).toBeNull();
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeUndefined();
    expect(omitUndefined({ name: "Demo", description: undefined, logo_url: null })).toEqual({
      name: "Demo",
      logo_url: null
    });
  });
});
