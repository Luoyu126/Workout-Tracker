import { supabase } from "@/lib/supabase/client";

export class AuthCallbackError extends Error {
  constructor() {
    super("Email confirmation callback failed");
  }
}

// Read once before startup session restoration. Never retain credentials in the URL.
// Native clients have no browser location; email links open the hosted web login.
export function consumeEmailCallback() {
  if (typeof window === "undefined" || !window.location || window.location.pathname.replace(/\/$/, "") !== "/login") {
    return null;
  }
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!["access_token", "refresh_token", "error", "error_code", "type"].some((key) => params.has(key))) {
    return null;
  }
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return establishCallbackSession(params);
}

async function establishCallbackSession(params: URLSearchParams) {
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (params.has("error") || params.has("error_code") || params.get("type") !== "signup" || !accessToken || !refreshToken) {
    throw new AuthCallbackError();
  }
  try {
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error || !data.session) {
      throw new AuthCallbackError();
    }
    return data.session;
  } catch {
    // Do not surface provider messages or URL fragments containing credentials.
    throw new AuthCallbackError();
  }
}
