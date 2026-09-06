export type AuthStatus = "checking" | "signedOut" | "needsProfile" | "error" | "ready";
export type ProfileCheckFailureStatus = Extract<AuthStatus, "signedOut" | "needsProfile" | "error">;

// These codes refer to the saved session, not a temporary transport failure.
const invalidStoredSessionCodes = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "user_not_found"
]);

export function startupSessionFailureStatus(error: unknown): "signedOut" | "error" {
  if (error !== null && typeof error === "object") {
    if ("status" in error && error.status === 401) {
      return "signedOut";
    }
    if ("code" in error && typeof error.code === "string" && invalidStoredSessionCodes.has(error.code)) {
      return "signedOut";
    }
    if ("name" in error && error.name === "AuthSessionMissingError") {
      return "signedOut";
    }
  }
  return "error";
}

export function profileCheckFailureStatus(error: unknown): ProfileCheckFailureStatus {
  const apiError =
    error !== null && typeof error === "object" && "code" in error && "status" in error
      ? (error as { code: unknown; status: unknown })
      : null;
  if (apiError?.code === "USER_NOT_SYNCED") {
    return "needsProfile";
  }
  if (
    apiError !== null &&
    (apiError.status === 401 || apiError.code === "UNAUTHENTICATED" || apiError.code === "INVALID_TOKEN")
  ) {
    return "signedOut";
  }
  return "error";
}
