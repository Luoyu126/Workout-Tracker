import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0,
  focus: null as null | (() => () => void), members: vi.fn(), update: vi.fn()
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
  useRef: (initial: unknown) => {
    const index = h.refIndex++;
    if (!h.refs[index]) h.refs[index] = { current: initial };
    return h.refs[index];
  },
  useCallback: (fn: unknown) => fn
}));
vi.mock("expo-router", () => ({ useFocusEffect: (fn: () => () => void) => { h.focus = fn; } }));
// These role/request tests keep feedback state; timer behavior is covered separately.
vi.mock("@/lib/ui/useTransientFeedback", async () => {
  const { useState } = await import("react");
  return { useTransientFeedback: () => useState(null) };
});
vi.mock("react-native", () => ({ Text: "text", View: "view", StyleSheet: { create: (value: unknown) => value } }));
vi.mock("@/components/ui", () => ({ Button: "button", Card: "card", EmptyState: "empty" }));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/features/teams/api", () => ({ getJoinRequests: h.members, updateTeamMember: h.update }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "request failed" }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));

import { InboxJoinRequests } from "@/features/teams/InboxJoinRequests";

type Props = { children?: ReactNode; label?: string; title?: string; message?: string; disabled?: boolean;
  loadState?: { status: string; error?: unknown }; onPress?: () => void; onRetry?: () => void };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Props>(node) ? [node.props, ...nodes(node.props.children)] : [];
}
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<Props>(node) ? [node.props.label, node.props.title, text(node.props.children)].join(" ") : "";
}
function render() {
  h.index = 0; h.refIndex = 0;
  return InboxJoinRequests({ teamId: "team", refreshVersion: 0 });
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function load() { render(); const cleanup = h.focus?.(); await flush(); return cleanup; }
function press(label: string) {
  const button = nodes(render()).find((node) => node.label === label);
  expect(button?.onPress).toBeDefined(); button?.onPress?.();
}
const first = { id: "first", user_id: "first-user", request_submitted_at: "2026-09-01T10:00:00Z", user: { name: "First Applicant", email: "first@example.test" } };
const second = { id: "second", user_id: "second-user", request_submitted_at: "2026-09-02T10:00:00Z", user: { name: "Second Applicant" } };
beforeEach(() => {
  vi.resetAllMocks(); h.states = []; h.refs = []; h.focus = null;
  h.members.mockResolvedValue([first, second]);
});
test("shows server submission order and applicant details", async () => {
  await load();
  expect(h.members).toHaveBeenCalledOnce();
  expect(h.members).toHaveBeenCalledWith("team");
  const ui = text(render());
  expect(ui.indexOf("First Applicant")).toBeLessThan(ui.indexOf("Second Applicant"));
  expect(ui).toContain("first@example.test"); expect(ui).toContain("inbox.requestSubmittedAt");
});
test.each([["members.approve", "active"], ["members.reject", "inactive"]])("%s removes the processed request and reloads pending state", async (label, status) => {
  await load(); h.members.mockResolvedValue([second]);
  press(label); await flush();
  expect(h.update).toHaveBeenCalledOnce();
  expect(h.update).toHaveBeenCalledWith("team", "first-user", { status });
  expect(text(render())).not.toContain("First Applicant");
  expect(text(render())).toContain("Second Applicant");
});
test("failed approval preserves the request and prevents duplicate submissions", async () => {
  await load(); h.update.mockRejectedValueOnce(new Error("offline"));
  press("members.approve"); press("members.approve"); await flush();
  expect(h.update).toHaveBeenCalledOnce();
  expect(text(render())).toContain("First Applicant");
  expect(nodes(render()).find((node) => node.message)?.message).toBe("request failed");
});
test("load failure retains the original error without showing an empty state, then retries", async () => {
  const error = new Error("offline"); h.members.mockRejectedValueOnce(error);
  await load();
  const state = nodes(render()).find((node) => node.loadState);
  expect(state?.loadState).toEqual({ status: "error", error });
  expect(text(render())).not.toContain("members.noRequests");
  h.members.mockResolvedValue([]); state?.onRetry?.(); await flush();
  expect(text(render())).toContain("members.noRequests");
});
test("unknown historical timestamps are not presented as submission times", async () => {
  h.members.mockResolvedValue([{ ...first, request_submitted_at: null }]); await load();
  expect(text(render())).toContain("inbox.requestTimeUnknown");
});
test("returning to inbox refreshes externally processed requests and ignores stale reads", async () => {
  const cleanup = await load(); cleanup?.();
  let resolveOld: ((value: typeof first[]) => void) | undefined;
  h.members.mockImplementationOnce(() => new Promise<typeof first[]>((resolve) => { resolveOld = resolve; }));
  const oldCleanup = h.focus?.(); oldCleanup?.();
  h.members.mockResolvedValue([]); h.focus?.(); await flush();
  resolveOld?.([first]); await flush();
  expect(text(render())).toContain("members.noRequests");
  expect(text(render())).not.toContain("First Applicant");
});
