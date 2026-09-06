import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  entry: null as unknown,
  deps: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined
}));
vi.mock("react", () => ({
  useState: () => [h.entry, (value: unknown) => { h.entry = value; }],
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    if (!h.deps || deps.some((value, index) => value !== h.deps?.[index])) {
      h.cleanup?.();
      h.deps = deps;
      h.cleanup = effect() || undefined;
    }
  }
}));

import { useTransientFeedback } from "../src/lib/ui/useTransientFeedback";

beforeEach(() => {
  vi.useFakeTimers();
  h.entry = null; h.deps = undefined; h.cleanup = undefined;
});
afterEach(() => { h.cleanup?.(); vi.useRealTimers(); });

function show(message: string, hidden = false) {
  useTransientFeedback(hidden)[1](message);
  return useTransientFeedback(hidden)[0];
}

test.each(["报名已更新", "保存成功", "操作失败"])("clears %s at three seconds", (message) => {
  expect(show(message)).toBe(message);
  vi.advanceTimersByTime(2999);
  expect(useTransientFeedback()[0]).toBe(message);
  vi.advanceTimersByTime(1);
  expect(useTransientFeedback()[0]).toBeNull();
});

test("repeated identical feedback and replacement feedback each get a new three seconds", () => {
  show("saved");
  vi.advanceTimersByTime(2000);
  show("saved");
  vi.advanceTimersByTime(2000);
  expect(useTransientFeedback()[0]).toBe("saved");
  show("failed");
  vi.advanceTimersByTime(2999);
  expect(useTransientFeedback()[0]).toBe("failed");
  vi.advanceTimersByTime(1);
  expect(useTransientFeedback()[0]).toBeNull();
});

test("waits for loading to finish before starting the visible feedback timer", () => {
  show("saved", true);
  vi.advanceTimersByTime(5000);
  expect(useTransientFeedback(true)[0]).toBe("saved");
  useTransientFeedback(false);
  vi.advanceTimersByTime(2999);
  expect(useTransientFeedback()[0]).toBe("saved");
  vi.advanceTimersByTime(1);
  expect(useTransientFeedback()[0]).toBeNull();
});

test("clearing feedback and unmounting both cancel the timer", () => {
  show("saved");
  useTransientFeedback()[1](null);
  expect(useTransientFeedback()[0]).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  show("saved");
  h.cleanup?.();
  expect(vi.getTimerCount()).toBe(0);
});
