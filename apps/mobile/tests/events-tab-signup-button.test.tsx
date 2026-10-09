import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  focusIndex: 0,
  focus: [] as (() => void | (() => void))[],
  push: vi.fn(),
  getTeamEvents: vi.fn(),
  role: "admin" as "admin" | "member",
  events: [] as {
    id: string;
    title: string;
    type: string;
    status: string;
    start_time: string;
    end_time: string;
    location: string | null;
  }[]
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
  useCallback: (fn: unknown) => fn
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: h.push }),
  useFocusEffect: (fn: () => void) => { h.focus[h.focusIndex++] = fn; }
}));
vi.mock("react-native", () => ({
  Text: "text",
  View: "view",
  Pressable: "pressable",
  StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "icon" }));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/components/ui", () => ({
  Badge: "badge",
  Button: "button",
  Card: "card",
  EmptyState: "empty",
  Screen: "screen",
  SegmentedControl: "segmented"
}));
vi.mock("@/features/events/api", () => ({ getTeamEvents: h.getTeamEvents }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/providers/TeamProvider", () => ({
  useTeamContext: () => ({
    selectedTeamId: "team",
    role: h.role,
    home: { team: { name: "Team" } },
    loadState: { status: "success" },
    refresh: vi.fn()
  })
}));

import EventsTabScreen from "../app/(app)/(tabs)/events";

type Props = {
  children?: ReactNode;
  label?: string;
  title?: string;
  onPress?: () => void;
};

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

function render() {
  h.index = 0;
  h.focusIndex = 0;
  return EventsTabScreen();
}

async function focus() {
  h.focus.forEach((fn) => fn());
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const sampleEvent = {
  id: "event-1",
  title: "Morning training",
  type: "training",
  status: "published",
  start_time: "2099-09-10T10:00:00Z",
  end_time: "2099-09-10T12:00:00Z",
  location: "Pitch"
};

beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.focus = [];
  h.role = "admin";
  h.events = [sampleEvent];
  h.getTeamEvents.mockImplementation(async () => h.events);
});

test("admin event card opens detail from body and signup list from corner button", async () => {
  render();
  await focus();
  const ui = render();
  expect(text(ui)).toContain("Morning training");
  expect(text(ui)).toContain("events.signupList");

  const detailPress = nodes(ui).find(
    (node) => node.onPress && text(node.children).includes("Morning training")
  );
  detailPress?.onPress?.();
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/events/[eventId]",
    params: { eventId: "event-1" }
  });

  h.push.mockClear();
  nodes(ui).find((node) => node.label === "events.signupList")?.onPress?.();
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/events/[eventId]/signups",
    params: { eventId: "event-1" }
  });
});

test("member event card opens detail and has no signup-list button", async () => {
  h.role = "member";
  render();
  await focus();
  const ui = render();
  expect(text(ui)).toContain("Morning training");
  expect(text(ui)).not.toContain("events.signupList");

  nodes(ui).find(
    (node) => node.onPress && text(node.children).includes("Morning training")
  )?.onPress?.();
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/events/[eventId]",
    params: { eventId: "event-1" }
  });
});
