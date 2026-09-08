import { isValidElement, type ReactNode } from "react";
import { AuthWeakPasswordError } from "@supabase/supabase-js";
import { translations, type Locale, type TranslationKey } from "../src/lib/i18n/translations";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0,
  effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[],
  status: "signedOut", error: null as unknown,
  locale: null as Locale | null,
  signUp: vi.fn(), signIn: vi.fn()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { h.effects.push(effect); }
}));
vi.mock("react-native", () => ({ Text: "text", View: "view", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("@/components/ui", () => ({ Button: "button", Screen: "screen", TextField: "field" }));
vi.mock("@/components/LanguageToggle", () => ({ CompactLanguageToggle: "language" }));
vi.mock("@/lib/api/client", () => ({ apiConfig: { isConfigured: true, isMalformed: false } }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "request failed" }));
vi.mock("@/lib/api/loadState", () => ({ canRetryLoad: () => false }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: {} } }));
vi.mock("@/lib/supabase/config", () => ({ supabaseConfig: { isConfigured: true } }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({
  t: (key: TranslationKey) => h.locale ? translations[h.locale][key] : key
}) }));
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({
  status: h.status, error: h.error, signUpAndPrepare: h.signUp, signInAndPrepare: h.signIn,
  completeProfile: vi.fn(), retrySessionCheck: vi.fn(), signOut: vi.fn()
}) }));

import LoginScreen from "../app/login";
import { AuthCallbackError } from "../src/features/auth/callback";

type Props = { children?: ReactNode; label?: string; labelError?: string; onPress?: () => void; onChangeText?: (value: string) => void };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Props>(node) ? [node.props, ...nodes(node.props.children)] : [];
}
function content(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(content).join(" ");
  return isValidElement<Props>(node) ? content(node.props.children) : "";
}
function render() {
  h.cleanups.forEach((cleanup) => cleanup()); h.cleanups = []; h.effects = []; h.index = 0;
  const tree = LoginScreen();
  h.effects.forEach((effect) => { const cleanup = effect(); if (cleanup) h.cleanups.push(cleanup); });
  return tree;
}
function press(label: string) {
  const button = nodes(render()).find((node) => node.label === label && node.onPress);
  expect(button).toBeDefined(); button?.onPress?.();
}
function fill(label: string, value: string) {
  const field = nodes(render()).find((node) => node.label === label && node.onChangeText);
  expect(field).toBeDefined(); field?.onChangeText?.(value);
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); h.states = []; h.status = "signedOut"; h.error = null;
  h.locale = null;
  h.signUp.mockResolvedValue("verificationRequired");
});
afterEach(() => { h.cleanups.forEach((cleanup) => cleanup()); h.cleanups = []; vi.useRealTimers(); });

test("registration waits for email verification beyond the transient message timeout", async () => {
  press("auth.signUp");
  fill("auth.email", "player@example.test"); fill("auth.password", "secret-password"); fill("auth.name", "Player");
  press("auth.signUp"); await flush();
  expect(h.signUp).toHaveBeenCalledOnce();
  expect(content(render())).toContain("auth.signUpNeedsSignIn");
  vi.advanceTimersByTime(10000);
  expect(content(render())).toContain("auth.signUpNeedsSignIn");
  expect(nodes(render()).some((node) => node.label === "auth.signIn" && node.onPress)).toBe(true);
  h.status = "needsProfile";
  expect(content(render())).not.toContain("auth.signUpNeedsSignIn");
});

test("failed callback leaves a persistent error and an available password sign-in form", () => {
  h.error = new AuthCallbackError();
  expect(content(render())).toContain("auth.callbackFailed");
  vi.advanceTimersByTime(10000);
  expect(content(render())).toContain("auth.callbackFailed");
  expect(nodes(render()).some((node) => node.label === "auth.email" && node.onChangeText)).toBe(true);
});

test("password errors appear beside the label, follow language changes, and expire after 3 seconds", async () => {
  press("auth.signUp");
  fill("auth.email", "player@example.test"); fill("auth.password", "letters-only"); fill("auth.name", "Player");
  h.signUp.mockRejectedValue(new AuthWeakPasswordError("Password must contain letters and numbers", 422, ["characters"]));
  press("auth.signUp"); await flush();
  h.locale = "zh-CN";
  let tree = render();
  expect(nodes(tree).find((node) => node.label === "密码")?.labelError).toBe("密码必须包含字母和数字");
  expect(content(tree)).not.toContain("密码必须包含字母和数字");
  expect(content(tree)).not.toContain("Password must contain letters and numbers");
  expect(content(tree)).not.toContain("request failed");
  h.locale = "en";
  tree = render();
  expect(nodes(tree).find((node) => node.label === "Password")?.labelError).toBe("Password must contain letters and numbers");
  vi.advanceTimersByTime(3000);
  expect(nodes(render()).find((node) => node.label === "Password")?.labelError).toBeUndefined();
});

test("editing the password clears its error and other registration errors stay in page feedback", async () => {
  press("auth.signUp");
  fill("auth.email", "player@example.test"); fill("auth.password", "letters-only"); fill("auth.name", "Player");
  h.signUp.mockRejectedValue(new AuthWeakPasswordError("Weak password", 422, ["characters"]));
  press("auth.signUp"); await flush();
  expect(nodes(render()).find((node) => node.label === "auth.password")?.labelError).toBe("auth.passwordHint");
  fill("auth.password", "Password123");
  expect(nodes(render()).find((node) => node.label === "auth.password")?.labelError).toBeUndefined();
  h.signUp.mockRejectedValue(new Error("Registration failed"));
  press("auth.signUp"); await flush();
  expect(content(render())).toContain("request failed");
  expect(nodes(render()).find((node) => node.label === "auth.password")?.labelError).toBeUndefined();
});
