export type AuthStatus = "checking" | "signedOut" | "needsProfile" | "error" | "ready";
export type ProfileCheckFailureStatus = Extract<AuthStatus, "signedOut" | "needsProfile" | "error">;

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
