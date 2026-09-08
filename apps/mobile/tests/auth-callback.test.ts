import { afterEach, beforeEach, expect, test, vi } from "vitest";

const setSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { setSession } } }));

import { AuthCallbackError, consumeEmailCallback } from "../src/features/auth/callback";

function browser(hash: string, pathname = "/login") {
  const location = { pathname, search: "?source=email", hash };
  const replaceState = vi.fn(() => { location.hash = ""; });
  vi.stubGlobal("window", { location, history: { state: { key: "route" }, replaceState } });
  return { location, replaceState };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

test("ordinary login and native startup do not attempt a callback", () => {
  expect(consumeEmailCallback()).toBeNull();
  browser("");
  expect(consumeEmailCallback()).toBeNull();
  browser("#section");
  expect(consumeEmailCallback()).toBeNull();
  expect(setSession).not.toHaveBeenCalled();
});

test("valid signup callback cleans credentials before SDK validation and is consumed once", async () => {
  const { location, replaceState } = browser("#access_token=test-access&refresh_token=test-refresh&type=signup", "/login/");
  const session = { access_token: "test-access" };
  setSession.mockImplementation(async () => {
    expect(location.hash).toBe("");
    return { data: { session }, error: null };
  });
  await expect(consumeEmailCallback()).resolves.toBe(session);
  expect(setSession).toHaveBeenCalledWith({ access_token: "test-access", refresh_token: "test-refresh" });
  expect(replaceState).toHaveBeenCalledWith({ key: "route" }, "", "/login/?source=email");
  expect(consumeEmailCallback()).toBeNull();
});

test.each([
  "#error=access_denied&error_code=otp_expired&error_description=untrusted-message",
  "#access_token=test-access&type=signup",
  "#refresh_token=test-refresh&type=signup",
  "#access_token=test-access&refresh_token=test-refresh&type=recovery",
  "#type=signup"
])("rejects malformed or failed callbacks and cleans the fragment: %s", async (hash) => {
  const { location } = browser(hash);
  await expect(consumeEmailCallback()).rejects.toBeInstanceOf(AuthCallbackError);
  expect(location.hash).toBe("");
  expect(setSession).not.toHaveBeenCalled();
});

test.each(["rejected", "error", "empty"])("SDK %s does not become success or leak credentials", async (failure) => {
  browser("#access_token=test-access&refresh_token=test-refresh&type=signup");
  if (failure === "rejected") setSession.mockRejectedValue(new Error("secret-provider-message"));
  else setSession.mockResolvedValue({ data: { session: null }, error: failure === "error" ? new Error("secret-provider-message") : null });
  await expect(consumeEmailCallback()).rejects.toEqual(new AuthCallbackError());
});
