import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0,
  focus: null as null | (() => () => void), signups: vi.fn()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = h.refIndex++;
    if (!h.refs[index]) h.refs[index] = { current: initial };
    return h.refs[index];
  },
  useCallback: (fn: unknown) => fn
}));
vi.mock("expo-router", () => ({ useFocusEffect: (fn: () => () => void) => { h.focus = fn; } }));
vi.mock("react-native", () => ({ Text: "text", View: "view", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("@/components/ui", () => ({ Card: "card", EmptyState: "empty", Screen: "screen" }));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/features/events/api", () => ({ getEventSignups: h.signups }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { EventChain } from "../app/(app)/events/[eventId]/chain";

type Props = { children?: ReactNode; title?: string; loadState?: { status: string; error?: unknown }; onRetry?: () => void; onRefresh?: () => void };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Props>(node) ? [node.props, ...nodes(node.props.children)] : [];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Props>(node) ? [node.props.title, text(node.props.children)].join("") : "";
}
function render() { h.index = 0; h.refIndex = 0; return EventChain({ eventId: "event" }); }
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
async function load() { render(); const cleanup = h.focus?.(); await flush(); return cleanup; }
const rows = [
  { user_id: "late", status: "going", user: { name: "Zoe" }, note: null, updated_at: "2026-09-10T12:00:00Z" },
  { user_id: "early", status: "going", user: { name: "Alice" }, note: null, updated_at: "2026-09-10T10:00:00Z" },
  { user_id: "leave", status: "not_going", user: { name: "Bob" }, note: "工作出差", updated_at: "2026-09-10T11:00:00Z" },
  { user_id: "maybe", id: null, status: "maybe", user: { name: "Charlie" }, note: null, updated_at: null }
];
beforeEach(() => {
  vi.resetAllMocks(); h.states = []; h.refs = []; h.focus = null;
  h.signups.mockResolvedValue(rows);
});

test("loads once and lists confirmed then leave members by updated_at without notes or maybe", async () => {
  await load();
  expect(h.signups).toHaveBeenCalledOnce();
  expect(h.signups).toHaveBeenCalledWith("event");
  const ui = text(render());
  expect(ui).toContain("events.chainList.going (2)");
  expect(ui).toContain("events.chainList.not_going (1)");
  expect(ui).not.toContain("events.chainList.maybe");
  expect(ui).not.toContain("Charlie");
  expect(ui).not.toContain("工作出差");
  expect(ui.indexOf("Alice")).toBeLessThan(ui.indexOf("Zoe"));
  expect(ui).toContain("Bob");
});

test("successful empty response displays only the empty state", async () => {
  h.signups.mockResolvedValue([]); await load();
  const ui = text(render());
  expect(ui).toContain("events.signupList.empty");
  expect(ui).not.toContain("events.chainList.going");
});

test("members with only unconfirmed responses still show empty confirmed and leave groups", async () => {
  h.signups.mockResolvedValue([rows[3]]); await load();
  const ui = text(render());
  expect(ui).toContain("events.chainList.going (0)");
  expect(ui).toContain("events.chainList.not_going (0)");
  expect(ui).toContain("events.signupList.emptyGroup");
  expect(ui).not.toContain("Charlie");
});

test.each([403, 500])("preserves %s errors for ScreenState without showing empty data or retrying automatically", async (status) => {
  const error = { status, message: "failed" };
  h.signups.mockRejectedValue(error); await load();
  expect(nodes(render()).find((node) => node.loadState)?.loadState).toEqual({ status: "error", error });
  expect(text(render())).not.toContain("events.signupList.empty");
  expect(h.signups).toHaveBeenCalledOnce();
  h.signups.mockResolvedValue(rows);
  nodes(render()).find((node) => node.onRetry)?.onRetry?.(); await flush();
  expect(text(render())).toContain("Alice");
});

test("refresh hides previous names, and a failed refresh does not expose stale data", async () => {
  await load();
  h.signups.mockRejectedValue(new Error("offline"));
  nodes(render()).find((node) => node.onRefresh)?.onRefresh?.();
  expect(text(render())).not.toContain("Alice");
  await flush();
  expect(text(render())).not.toContain("Alice");
});

test("leaving the screen ignores late responses", async () => {
  let resolve: (value: typeof rows) => void = () => undefined;
  h.signups.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const cleanup = await load(); cleanup?.(); resolve(rows); await flush();
  expect(text(render())).not.toContain("Alice");
});
