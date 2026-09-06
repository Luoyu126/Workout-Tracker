import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, focusIndex: 0, effectIndex: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[], update: vi.fn(),
  focus: [] as (() => void | (() => void))[], signup: vi.fn(), refresh: vi.fn(), push: vi.fn(), role: "admin",
  events: [] as { id: string; title: string; type: string; start_time: string; end_time: string; location: string }[]
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
  useEffect: (fn: () => (() => void) | void, deps: unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
      previous?.cleanup?.();
      h.effects[index] = { deps, cleanup: fn() || undefined };
    }
  }, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn
}));
vi.mock("expo-router", () => ({
  Link: "link", useRouter: () => ({ push: h.push }),
  useFocusEffect: (fn: () => void) => { h.focus[h.focusIndex++] = fn; }
}));
vi.mock("react-native", () => ({
  Text: "text", View: "view", Pressable: "pressable", Modal: "modal", StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "icon" }));
vi.mock("@/components/LanguageToggle", () => ({ CompactLanguageToggle: "language" }));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/components/ui", () => ({ Avatar: "avatar", Badge: "badge", Button: "button", Card: "card", EmptyState: "empty", Screen: "screen" }));
vi.mock("@/features/events/api", () => ({ getMySignup: h.signup, updateMySignup: h.update }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "failed" }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/providers/TeamProvider", () => ({ useTeamContext: () => ({
  teams: [], selectedTeamId: "team", isLoading: false, error: null, loadState: { status: "success" },
  refresh: h.refresh, selectTeam: vi.fn(), home: {
    team: { id: "team", name: "Team" }, current_membership: { role: h.role },
    upcoming_events: h.events, signup_summary: { going: 3, total: 4 }, coin_summary: { balance: 100 }
  }
}) }));

import Home from "../app/(app)/(tabs)/index";
type Props = { message?: string | null; children?: ReactNode; label?: string; title?: string; onPress?: () => void; style?: { flex?: number; flexDirection?: string }; visible?: boolean };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (!isValidElement<Props>(node)) return "";
  return [node.props.label, node.props.title, text(node.props.children)].join(" ");
}
function render() { h.index = 0; h.refIndex = 0; h.focusIndex = 0; h.effectIndex = 0; return Home(); }
async function focus() { h.focus.forEach((fn) => fn()); for (let i = 0; i < 10; i++) await Promise.resolve(); }
const upcoming = { id: "event", title: "Tomorrow training", type: "training", start_time: "2099-09-10T10:00:00Z", end_time: "2099-09-10T12:00:00Z", location: "Pitch" };
beforeEach(() => {
  vi.useFakeTimers(); h.effects = [];
  vi.resetAllMocks(); h.states = []; h.refs = []; h.focus = []; h.role = "admin"; h.events = [upcoming];
  h.signup.mockResolvedValue({ status: "going" });
});
afterEach(() => { h.effects.forEach((effect) => effect.cleanup?.()); vi.useRealTimers(); vi.restoreAllMocks(); });
test.each([
  ["training", "admin", "10:00:00", "home.trainingInProgress"],
  ["match", "admin", "11:00:00", "home.matchInProgress"],
  ["training", "member", "11:00:00", "home.trainingInProgress"]
])("%s in progress is marked for %s at %s", (type, role, time, label) => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(`2099-09-10T${time}Z`));
  h.events = [{ ...upcoming, type }]; h.role = role;
  expect(text(render())).toContain(label);
});
test.each(["09:59:59", "12:00:00", "12:00:01"])("no in-progress marker outside the event at %s", (time) => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(`2099-09-10T${time}Z`));
  const ui = text(render());
  expect(ui).not.toContain("home.trainingInProgress");
  expect(ui).not.toContain("home.matchInProgress");
});
test("admin sees upcoming event and a full-row attendance card without coins or signup actions", async () => {
  render(); await focus(); const ui = render();
  expect(text(ui)).toContain("Tomorrow training");
  expect(text(ui)).toContain("75%");
  expect(text(ui)).not.toContain("home.coins");
  expect(text(ui)).not.toContain("home.confirmGoing");
  expect(h.signup).not.toHaveBeenCalled();
  const metrics = nodes(ui).find((node) => {
    const children = nodes(node.children);
    return children.some((child) => child.children === "home.attendance") && !children.some((child) => child.children === "home.nextEvent");
  });
  expect(metrics).toBeDefined();
  const attendance = nodes(ui).find((node) => node.onPress && text(node.children).includes("home.attendance"));
  expect(attendance?.style?.flex).toBe(1);
  nodes(ui).find((node) => node.label === "events.detail")?.onPress?.();
  expect(h.push).toHaveBeenCalledWith({ pathname: "/events/[eventId]", params: { eventId: "event" } });
});
test("returning from event creation refreshes home without duplicating its initial load", async () => {
  h.events = []; render(); await focus();
  expect(h.refresh).not.toHaveBeenCalled();
  h.refresh.mockImplementation(async () => { h.events = [upcoming]; });
  await focus();
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(text(render())).toContain("Tomorrow training");
});
test("member retains coin balance and personal signup", async () => {
  h.role = "member"; render(); await focus();
  const ui = render();
  expect(text(ui)).toContain("home.coins");
  expect(text(ui)).toContain("home.confirmedGoing");
  expect(h.signup).toHaveBeenCalledWith("event");
});
test("home confirmation feedback disappears after three seconds", async () => {
  h.role = "member";
  h.signup.mockResolvedValue({ status: "maybe" });
  h.update.mockResolvedValue({ status: "going" });
  render(); await focus();
  nodes(render()).find((node) => node.label === "home.confirmGoing")?.onPress?.();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(h.update).toHaveBeenCalledWith("event", "going", null);
  expect(nodes(render()).some((node) => node.message === "events.signupSaved")).toBe(true);
  vi.advanceTimersByTime(2999);
  expect(nodes(render()).some((node) => node.message === "events.signupSaved")).toBe(true);
  vi.advanceTimersByTime(1);
  expect(nodes(render()).some((node) => node.message === "events.signupSaved")).toBe(false);
  expect(text(render())).toContain("home.confirmedGoing");
});

test("admin signup-list button follows event details and opens the current event", () => {
  const buttons = nodes(render()).filter((node) => node.label);
  const detailIndex = buttons.findIndex((node) => node.label === "events.detail");
  const signupIndex = buttons.findIndex((node) => node.label === "events.signupList");
  expect(signupIndex).toBeGreaterThan(detailIndex);
  buttons[signupIndex].onPress?.();
  expect(h.push).toHaveBeenCalledWith({ pathname: "/events/[eventId]/signups", params: { eventId: "event" } });
  h.role = "member";
  expect(text(render())).not.toContain("events.signupList");
});
