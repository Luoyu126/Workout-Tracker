import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, started: false,
  event: vi.fn(), team: vi.fn(), signup: vi.fn(), update: vi.fn()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
  useEffect: (effect: () => void) => { if (!h.started) { h.started = true; effect(); } }
}));
// These role/request tests keep feedback state; timer behavior is covered separately.
vi.mock("@/lib/ui/useTransientFeedback", async () => {
  const { useState } = await import("react");
  return { useTransientFeedback: () => useState(null) };
});
vi.mock("react-native", () => ({
  Text: "text", View: "view", Pressable: "button", ScrollView: "scroll", TextInput: "input",
  Alert: { alert: vi.fn() }, StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "header" }, Link: "link", useRouter: () => ({ replace: vi.fn() }),
  useLocalSearchParams: () => ({ eventId: "created-event" })
}));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/components/ui/DateTimeField", () => ({ DateTimeField: "date" }));
vi.mock("@/features/teams/api", () => ({ getTeamHome: h.team }));
vi.mock("@/features/events/api", () => ({
  getEvent: h.event, getMySignup: h.signup, updateEvent: h.update,
  updateMySignup: vi.fn(), deleteEvent: vi.fn()
}));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "request failed" }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import EventDetail from "../app/(app)/events/[eventId]";

type Props = { children?: ReactNode; loadState?: { status: string; error?: unknown }; onPress?: () => Promise<void> };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<Props>(node) ? text(node.props.children) : "";
}
function render() { h.index = 0; return EventDetail(); }
async function load() {
  render();
  for (let index = 0; index < 20; index++) await Promise.resolve();
  return render();
}
beforeEach(() => {
  vi.resetAllMocks(); h.states = []; h.started = false;
  h.event.mockResolvedValue({
    id: "created-event", team_id: "event-team", type: "training", title: "New training",
    status: "published", start_time: "2099-09-10T10:00:00Z", end_time: "2099-09-10T12:00:00Z",
    match_details: null
  });
  h.team.mockResolvedValue({ current_membership: { role: "admin" } });
  h.signup.mockRejectedValue(new Error("Only members can sign up for events"));
});

test("admin opens a newly created activity and refreshes after editing without requesting personal signup", async () => {
  const ui = await load();
  expect(h.team).toHaveBeenCalledWith("event-team");
  expect(h.signup).not.toHaveBeenCalled();
  expect(nodes(ui).find((node) => node.loadState)?.loadState?.status).toBe("success");
  expect(text(ui)).toContain("New training");
  expect(text(ui)).toContain("events.update");
  expect(text(ui)).not.toContain("events.mySignup");
  expect(text(ui)).not.toContain("events.signupSubmit");
  const edit = nodes(ui).find((node) => node.onPress && text(node.children) === "events.update");
  expect(edit).toBeDefined();
  await edit?.onPress?.();
  expect(h.update).toHaveBeenCalledOnce();
  expect(h.event).toHaveBeenCalledTimes(2);
  expect(h.signup).not.toHaveBeenCalled();
});

test("member still loads their signup and sees signup controls", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  h.signup.mockResolvedValue({ status: "going", note: null });
  const ui = await load();
  expect(h.signup).toHaveBeenCalledOnce();
  expect(h.signup).toHaveBeenCalledWith("created-event");
  expect(text(ui)).toContain("events.mySignup");
  expect(text(ui)).toContain("events.signupSubmit");
  expect(text(ui)).not.toContain("events.update");
});

test("member signup errors remain page errors", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  const ui = await load();
  expect(nodes(ui).find((node) => node.loadState)?.loadState?.status).toBe("error");
  expect(text(ui)).not.toContain("events.mySignup");
});

test("failed team permission lookup does not request signup or expose controls", async () => {
  h.team.mockRejectedValue(new Error("Permission denied"));
  const ui = await load();
  expect(h.signup).not.toHaveBeenCalled();
  expect(nodes(ui).find((node) => node.loadState)?.loadState?.status).toBe("error");
  expect(text(ui)).not.toContain("events.update");
  expect(text(ui)).not.toContain("events.signupSubmit");
});
