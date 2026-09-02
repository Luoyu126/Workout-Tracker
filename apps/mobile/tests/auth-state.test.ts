import { describe, expect, test } from "vitest";

import { profileCheckFailureStatus } from "../src/features/auth/state";

describe("auth profile gate state", () => {
  test("requires profile completion for a signed-in user missing a backend profile", () => {
    expect(profileCheckFailureStatus({ status: 404, code: "USER_NOT_SYNCED" })).toBe("needsProfile");
  });

  test.each([
    { status: 401, code: "UNAUTHENTICATED" },
    { status: 401, code: "INVALID_TOKEN" },
    { status: 401, code: "REQUEST_FAILED" }
  ])("treats invalid or unauthorized sessions as signed out", (error) => {
    expect(profileCheckFailureStatus(error)).toBe("signedOut");
  });

  test.each([
    { code: "NETWORK_UNAVAILABLE" },
    { status: 503, code: "INTERNAL_ERROR" },
    new Error("Unexpected failure")
  ])("keeps retryable failures behind the auth gate", (error) => {
    expect(profileCheckFailureStatus(error)).toBe("error");
  });
});
