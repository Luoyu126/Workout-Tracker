import { describe, expect, test } from "vitest";

import { normalizeAuthCredentials, normalizeProfileInput } from "../src/features/auth/validation";

describe("auth profile validation", () => {
  test("normalizes auth credentials", () => {
    expect(normalizeAuthCredentials(" player@example.com ", " secret ")).toEqual({
      email: "player@example.com",
      password: "secret"
    });
  });

  test("rejects blank auth credentials", () => {
    expect(normalizeAuthCredentials("   ", "secret")).toBeNull();
    expect(normalizeAuthCredentials("player@example.com", "   ")).toBeNull();
  });

  test("normalizes required profile name and optional student id", () => {
    expect(normalizeProfileInput(" 小陈 ", " 9 ", " https://cdn.example.test/avatar.png ")).toEqual({
      name: "小陈",
      student_id: "9",
      avatar_url: "https://cdn.example.test/avatar.png"
    });
    expect(normalizeProfileInput("小陈", "   ")).toEqual({
      name: "小陈",
      student_id: null,
      avatar_url: null
    });
  });

  test("rejects blank profile names", () => {
    expect(normalizeProfileInput("   ", "9")).toBeNull();
  });
});
