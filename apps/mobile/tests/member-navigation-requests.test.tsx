import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, started: false,
  team: vi.fn(), members: vi.fn(), update: vi.fn(), push: vi.fn(), add: vi.fn(), candidates: vi.fn()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = h.refIndex++;
    if (!h.refs[index]) h.refs[index] = { current: initial };
    return h.refs[index];
  },
  useEffect: (effect: () => void) => { if (!h.started) { h.started = true; effect(); } }
}));
vi.mock("react-native", () => ({
  Text: "text", View: "view", Pressable: "button", ScrollView: "scroll", TextInput: "input",
  Alert: { alert: vi.fn() }, StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "header" }, Link: "link", useRouter: () => ({ push: h.push }),
  useLocalSearchParams: () => ({ teamId: "team" })
}));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/components/ui", () => ({ Screen: "screen", Button: "button", Card: "card", EmptyState: "empty" }));
vi.mock("@/features/teams/api", () => ({ getTeamHome: h.team, getTeamMembers: h.members, updateTeamMember: h.update, addTeamMember: h.add, getMemberCandidates: h.candidates }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "request failed" }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { MemberMenu } from "../app/(app)/teams/[teamId]/members";
import { JoinRequests } from "../app/(app)/teams/[teamId]/members/requests";
let screen = JoinRequests;

type Props = { children?: ReactNode; label?: string; title?: string; message?: string | null; disabled?: boolean; loadState?: { status: string; error?: unknown }; onPress?: () => Promise<void> };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<Props>(node) ? [node.props.label, node.props.title, text(node.props.children)].join(" ") : "";
}
function render() { h.index = 0; h.refIndex = 0; return screen({ teamId: "team" }); }
async function load() {
  render();
  for (let index = 0; index < 20; index++) await Promise.resolve();
  return render();
}
const request = { id: "request", team_id: "team", user_id: "applicant", role: "member", status: "pending", user: { name: "Applicant", email: "applicant@example.com" } };
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function press(label: string) {
  const button = nodes(render()).find((node) => node.label === label && node.onPress);
  if (!button?.onPress) throw new Error(`Missing button ${label}`);
  void button.onPress();
}
beforeEach(() => {
  vi.resetAllMocks(); h.states = []; h.refs = []; h.started = false; screen = JoinRequests;
  h.team.mockResolvedValue({ current_membership: { role: "admin" } });
  h.members.mockResolvedValue([request]);
});
test("admin menu offers view and add routes", async () => {
  screen = MemberMenu;
  const ui = await load();
  expect(text(ui)).toContain("members.view"); expect(text(ui)).toContain("members.addNew");
  press("members.view");
  expect(h.push).toHaveBeenLastCalledWith({ pathname: "/teams/[teamId]/members/list", params: { teamId: "team" } });
  press("members.addNew");
  expect(h.push).toHaveBeenLastCalledWith({ pathname: "/teams/[teamId]/members/requests", params: { teamId: "team" } });
});
test.each([["members.approve", "active"], ["members.reject", "inactive"]])("%s updates the existing request and removes it from the pending list", async (label, status) => {
  await load();
  expect(h.members).toHaveBeenCalledWith("team", { role: "member", status: "pending" });
  press(label); await flush();
  expect(h.update).toHaveBeenCalledWith("team", "applicant", { status });
  expect(text(render())).not.toContain("Applicant");
  expect(text(render())).toContain("members.noRequests");
  expect(h.add).not.toHaveBeenCalled(); expect(h.candidates).not.toHaveBeenCalled();
});
test("approval blocks repeated clicks and failures keep the request available", async () => {
  await load();
  h.update.mockRejectedValueOnce(new Error("network"));
  press("members.approve"); press("members.approve"); await flush();
  expect(h.update).toHaveBeenCalledOnce();
  expect(text(render())).toContain("Applicant");
  expect(nodes(render()).find((node) => node.message)?.message).toBe("request failed");
  press("members.approve"); await flush();
  expect(h.update).toHaveBeenCalledTimes(2);
  expect(text(render())).toContain("members.noRequests");
});
test("member cannot open the approval entry or fetch pending requests", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  screen = MemberMenu;
  expect(text(await load())).not.toContain("members.addNew");
  h.states = []; h.refs = []; h.started = false; screen = JoinRequests;
  const ui = await load();
  expect(text(ui)).toContain("common.permissionDenied");
  expect(text(ui)).not.toContain("members.approve");
  expect(h.members).not.toHaveBeenCalled();
});
test("failed request loading shows an error instead of an empty list", async () => {
  h.members.mockRejectedValueOnce(new Error("offline"));
  const ui = await load();
  expect(nodes(ui).find((node) => node.loadState)?.loadState?.status).toBe("error");
  expect(text(ui)).not.toContain("members.noRequests");
});
