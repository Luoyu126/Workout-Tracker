import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Run the provider's startup effect with controlled promises and auth events.
// UI routing already uses signedOut to expose the login/register form.
const harness = vi.hoisted(() => ({
  effect: (): void | (() => void) => undefined,
  listener: (_event: AuthChangeEvent, _session: Session | null): void => undefined,
  states: [] as unknown[],
  stateIndex: 0,
  clear: vi.fn(),
  getSession: vi.fn<() => Promise<{ data: { session: Session | null }; error: unknown }>>(),
  setSession: vi.fn<() => Promise<{ data: { session: Session | null }; error: unknown }>>(),
  getMyProfile: vi.fn<() => Promise<void>>(),
  signOut: vi.fn(),
  unsubscribe: vi.fn()
}));

vi.mock("react", () => ({
  createContext: () => ({ Provider: "provider" }),
  useState: (initial: unknown) => {
    const index = harness.stateIndex++;
    return [initial, (value: unknown) => { if (index === 0) harness.states.push(value); }];
  },
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: typeof harness.effect) => { harness.effect = effect; }
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ clear: harness.clear }) }));
vi.mock("@/features/auth/api", () => ({
  getMyProfile: harness.getMyProfile,
  signIn: vi.fn(),
  signUp: vi.fn(),
  syncProfile: vi.fn(),
  signOut: harness.signOut
}));
vi.mock("@/lib/supabase/client", () => ({
  supabase: { auth: {
    getSession: harness.getSession,
    setSession: harness.setSession,
    onAuthStateChange: (listener: typeof harness.listener) => {
      harness.listener = listener;
      return { data: { subscription: { unsubscribe: harness.unsubscribe } } };
    }
  } }
}));

import { AuthProvider } from "../src/providers/AuthProvider";

const session: Session = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "test-user", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01" }
};
const expired = { status: 400, code: "refresh_token_not_found" };

function start() {
  AuthProvider({ children: null });
  return harness.effect();
}

async function flush() {
  // Flush the nested getSession/profile promise chain without timers or network.
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("AuthProvider startup restoration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    harness.states = [];
    harness.stateIndex = 0;
    harness.getMyProfile.mockResolvedValue();
    harness.setSession.mockResolvedValue({ data: { session }, error: null });
  });

  afterEach(() => vi.unstubAllGlobals());

  test("opens login for an invalid stored session without remote sign-out", async () => {
    harness.getSession.mockResolvedValue({ data: { session: null }, error: expired });
    start();
    await flush();
    expect(harness.states).toEqual(["signedOut"]);
    expect(harness.clear).toHaveBeenCalledOnce();
    expect(harness.signOut).not.toHaveBeenCalled();
  });

  test("does not overwrite SIGNED_OUT with the subsequent refresh failure", async () => {
    harness.getSession.mockImplementation(async () => {
      harness.listener("SIGNED_OUT", null);
      return { data: { session: null }, error: expired };
    });
    start();
    await flush();
    expect(harness.states).toEqual(["signedOut"]);
  });

  test("handles a rejected getSession promise as an invalid session", async () => {
    harness.getSession.mockRejectedValue(expired);
    start();
    await flush();
    expect(harness.states).toEqual(["signedOut"]);
  });

  test("keeps network failures retryable and preserves cached user data", async () => {
    harness.getSession.mockResolvedValue({ data: { session: null }, error: new Error("Failed to fetch") });
    start();
    await flush();
    expect(harness.states).toEqual(["error"]);
    expect(harness.clear).not.toHaveBeenCalled();
  });

  test("continues into the app when session restoration succeeds", async () => {
    harness.getSession.mockResolvedValue({ data: { session }, error: null });
    start();
    await flush();
    expect(harness.states).toEqual(["checking", "ready"]);
    expect(harness.getMyProfile).toHaveBeenCalledOnce();
  });

  test("shows login when no session is saved", async () => {
    harness.getSession.mockResolvedValue({ data: { session: null }, error: null });
    start();
    await flush();
    expect(harness.states).toEqual(["signedOut"]);
  });

  test("does not let an old startup result overwrite a newer signed-in session", async () => {
    harness.getSession.mockImplementation(async () => {
      harness.listener("SIGNED_IN", session);
      return { data: { session: null }, error: expired };
    });
    start();
    await flush();
    expect(harness.states).toEqual(["ready"]);
    expect(harness.clear).not.toHaveBeenCalled();
  });

  test("ignores startup completion after unmount", async () => {
    harness.getSession.mockResolvedValue({ data: { session: null }, error: expired });
    const cleanup = start();
    if (cleanup) cleanup();
    await flush();
    expect(harness.states).toEqual([]);
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });
});

function callbackWindow(hash = "#access_token=test-access&refresh_token=test-refresh&type=signup") {
  const location = { pathname: "/login", search: "", hash };
  const replaceState = vi.fn(() => { location.hash = ""; });
  vi.stubGlobal("window", { location, history: { state: null, replaceState } });
  return replaceState;
}

describe("email callback startup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    harness.states = [];
    harness.stateIndex = 0;
    harness.getMyProfile.mockResolvedValue();
    harness.setSession.mockResolvedValue({ data: { session }, error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("cleans URL and processes callback before profile lookup without restoring an old session", async () => {
    const replaceState = callbackWindow();
    start();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/login");
    expect(harness.getMyProfile).not.toHaveBeenCalled();
    await flush();
    expect(harness.states).toEqual(["checking", "ready"]);
    expect(harness.getSession).not.toHaveBeenCalled();
    expect(harness.getMyProfile).toHaveBeenCalledOnce();
  });

  test("ignores SDK SIGNED_IN while processing the callback", async () => {
    callbackWindow();
    harness.setSession.mockImplementation(async () => {
      await Promise.resolve();
      harness.listener("SIGNED_IN", session);
      return { data: { session }, error: null };
    });
    start();
    await flush();
    expect(harness.getMyProfile).toHaveBeenCalledOnce();
    expect(harness.states).toEqual(["checking", "ready"]);
  });

  test("new user must complete profile before entering the app", async () => {
    callbackWindow();
    harness.getMyProfile.mockRejectedValue({ status: 409, code: "USER_NOT_SYNCED" });
    start();
    await flush();
    expect(harness.states).toEqual(["checking", "needsProfile"]);
  });

  test("profile network failure stays an error rather than an empty profile or success", async () => {
    callbackWindow();
    harness.getMyProfile.mockRejectedValue(new Error("Network unavailable"));
    start();
    await flush();
    expect(harness.states).toEqual(["checking", "error"]);
    expect(harness.getMyProfile).toHaveBeenCalledOnce();
  });

  test("invalid callback opens login without falling back to an unrelated saved session", async () => {
    callbackWindow("#error=access_denied&error_code=otp_expired");
    start();
    await flush();
    expect(harness.states).toEqual(["signedOut"]);
    expect(harness.getSession).not.toHaveBeenCalled();
    expect(harness.getMyProfile).not.toHaveBeenCalled();
  });

  test("Strict Mode effect replay reuses callback after URL cleanup", async () => {
    callbackWindow();
    const cleanup = start();
    if (cleanup) cleanup();
    harness.effect();
    await flush();
    expect(harness.setSession).toHaveBeenCalledOnce();
    expect(harness.getMyProfile).toHaveBeenCalledOnce();
    expect(harness.getSession).not.toHaveBeenCalled();
    expect(harness.states).toEqual(["checking", "ready"]);
  });

  test("unmount during callback cannot update auth state", async () => {
    callbackWindow();
    const cleanup = start();
    if (cleanup) cleanup();
    await flush();
    expect(harness.states).toEqual([]);
    expect(harness.getMyProfile).not.toHaveBeenCalled();
  });
});
