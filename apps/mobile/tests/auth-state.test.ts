import { describe, expect, test } from "vitest";

import { profileCheckFailureStatus, startupSessionFailureStatus } from "../src/features/auth/state";

describe("saved session restoration failures", () => {
  test.each([
    { status: 400, code: "refresh_token_not_found" },
    { status: 400, code: "refresh_token_already_used" },
    { status: 400, code: "session_not_found" },
    { status: 400, code: "session_expired" },
    { status: 400, code: "bad_jwt" },
    { status: 400, code: "user_not_found" },
    { status: 401 },
    { name: "AuthSessionMissingError" }
  ])("returns to login for rejected saved credentials: %j", (error) => {
    expect(startupSessionFailureStatus(error)).toBe("signedOut");
  });

  test.each([
    { name: "AuthRetryableFetchError", status: 0 },
    { status: 503, code: "unexpected_failure" },
    { status: 429, code: "over_request_rate_limit" },
    { status: 400, code: "validation_failed" },
    new Error("Failed to fetch"),
    null
  ])("keeps temporary or unknown failures retryable: %j", (error) => {
    expect(startupSessionFailureStatus(error)).toBe("error");
  });
});

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
