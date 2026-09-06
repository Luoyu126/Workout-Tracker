import { ApiError, ApiNetworkError } from "./client";

export type LoadState =
  | { status: "idle" | "loading" | "success" }
  | { status: "error"; error: unknown };

export function canRetryLoad(state: LoadState): boolean {
  if (state.status !== "error") return false;
  const error = state.error;
  if (error instanceof ApiNetworkError || (error instanceof Error && error.name === "AuthRetryableFetchError")) {
    return true;
  }
  return error instanceof ApiError && [408, 429, 500, 502, 503, 504].includes(error.status);
}

export function isEmptyLoad(state: LoadState, count: number): boolean {
  return state.status === "success" && count === 0;
}
