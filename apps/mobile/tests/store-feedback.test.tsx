import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, effectIndex: 0, callbackIndex: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  callbacks: [] as { deps: unknown[]; value: unknown }[],
  items: vi.fn(), orders: vi.fn(), update: vi.fn(), t: (key: string) => key
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => {
      h.states[index] = typeof value === "function" ? value(h.states[index]) : value;
    }];
  },
  useCallback: (value: unknown, deps: unknown[]) => {
    const index = h.callbackIndex++;
    const previous = h.callbacks[index];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) h.callbacks[index] = { value, deps };
    return h.callbacks[index].value;
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
      previous?.cleanup?.();
      h.effects[index] = { deps, cleanup: effect() || undefined };
    }
  }
}));
vi.mock("react-native", () => ({
  Text: "text", View: "view", Pressable: "button", Image: "image",
  Alert: { alert: vi.fn() }, StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui", () => ({
  Badge: "badge", Button: "button", Card: "card", EmptyState: "empty", Screen: "screen",
  SegmentedControl: "segments", TextField: "field"
}));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/providers/TeamProvider", () => ({ useTeamContext: () => ({
  selectedTeamId: "team", role: "admin", home: { team: { name: "Team" } }, loadState: { status: "success" }
}) }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: h.t }) }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "failed" }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/uuid", () => ({ generateClientUuid: () => "uuid" }));
vi.mock("@/features/coins/api", () => ({ getCoinBalance: vi.fn() }));
vi.mock("@/features/store/api", () => ({
  getMyRedemptions: vi.fn(), getStoreItems: h.items, getTeamRedemptions: h.orders,
  cancelRedemption: vi.fn(), createStoreItem: vi.fn(), fulfillRedemption: vi.fn(),
  redeemStoreItem: vi.fn(), refundRedemption: vi.fn(), updateStoreItem: h.update
}));

import Store from "../app/(app)/(tabs)/store";

type Props = { children?: ReactNode; headerRight?: ReactNode; label?: string; message?: string | null; loadState?: { status: string }; onPress?: () => void };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children), ...nodes(node.props.headerRight)];
}
function render() {
  h.index = 0; h.effectIndex = 0; h.callbackIndex = 0;
  return nodes(Store());
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); return render(); }
function feedback() { return render().find((node) => node.loadState); }
async function update() {
  render().find((node) => node.label === "store.deactivate")?.onPress?.();
  return settle();
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetAllMocks();
  h.states = []; h.effects = []; h.callbacks = [];
  h.items.mockResolvedValue([{ id: "item", name: "Shirt", price: 10, stock: 2, is_active: true }]);
  h.orders.mockResolvedValue([]);
  render(); await settle();
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.useRealTimers();
});
test("header says add item and opens the creation form", () => {
  const header = render().find((node) => node.headerRight)?.headerRight;
  expect(nodes(header).some((node) => node.children === "store.addItem")).toBe(true);
  nodes(header).find((node) => node.onPress)?.onPress?.();
  expect(render().some((node) => node.label === "store.name")).toBe(true);
});
test("update feedback disappears after three seconds and repeated feedback restarts the timer", async () => {
  await update();
  expect(h.update).toHaveBeenCalledWith("item", { is_active: false });
  expect(feedback()?.message).toBe("store.updated");
  vi.advanceTimersByTime(2000);
  await update();
  vi.advanceTimersByTime(2999);
  expect(feedback()?.message).toBe("store.updated");
  vi.advanceTimersByTime(1);
  expect(feedback()?.message).toBeNull();
});
test("operation error feedback also expires", async () => {
  h.update.mockRejectedValueOnce(new Error("failed"));
  await update();
  expect(feedback()?.message).toBe("failed");
  vi.advanceTimersByTime(3000);
  expect(feedback()?.message).toBeNull();
});
test("unmount clears pending feedback timers", async () => {
  await update();
  expect(vi.getTimerCount()).toBe(1);
  h.effects.forEach((effect) => effect.cleanup?.());
  expect(vi.getTimerCount()).toBe(0);
});
test("page load errors remain after three seconds", async () => {
  h.items.mockRejectedValueOnce(new Error("offline"));
  const screen = render().find((node) => node.headerRight);
  expect(screen).toBeDefined();
  // Remount with a failed initial load.
  h.effects.forEach((effect) => effect.cleanup?.());
  h.states = []; h.effects = []; h.callbacks = [];
  render(); await settle();
  vi.advanceTimersByTime(3000);
  expect(feedback()?.loadState?.status).toBe("error");
});
