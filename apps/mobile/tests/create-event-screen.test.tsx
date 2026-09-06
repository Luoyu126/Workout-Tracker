import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0,
  started: false, getTeamHome: vi.fn(), createEvent: vi.fn(), createMatch: vi.fn(), replace: vi.fn(), uuid: vi.fn()
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: unknown) => { harness.states[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = harness.refIndex++;
    if (!harness.refs[index]) harness.refs[index] = { current: initial };
    return harness.refs[index];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void) => { if (!harness.started) { harness.started = true; effect(); } }
}));
vi.mock("expo-router", () => ({ Stack: { Screen: "header" }, useRouter: () => ({ replace: harness.replace }) }));
// These role/request tests keep feedback state; timer behavior is covered separately.
vi.mock("@/lib/ui/useTransientFeedback", async () => {
  const { useState } = await import("react");
  return { useTransientFeedback: () => useState(null) };
});
vi.mock("react-native", () => ({ Text: "text", StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock("@/components/ui", () => ({ Button: "button", Card: "card", Screen: "screen", SegmentedControl: "segments", TextField: "field" }));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/components/ui/DateTimeField", () => ({ DateTimeField: "datetime" }));
vi.mock("@/features/teams/api", () => ({ getTeamHome: harness.getTeamHome }));
vi.mock("@/features/events/api", () => ({ createEvent: harness.createEvent, createMatch: harness.createMatch }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "request failed" }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/uuid", () => ({ generateClientUuid: harness.uuid }));

import { CreateEventForm } from "../app/(app)/teams/[teamId]/events/new";

type Props = { children?: ReactNode; label?: string; message?: string; onPress?: () => void; onChange?: (value: string) => void; onChangeText?: (value: string) => void; options?: unknown; disabled?: boolean };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children)];
}
function render() {
  harness.index = 0; harness.refIndex = 0;
  return nodes(CreateEventForm({ teamId: "team-from-route" }));
}
async function flush() { for (let index = 0; index < 10; index++) await Promise.resolve(); }
async function start() { render(); await flush(); }
function fill(label: string, value: string) {
  const field = render().find((node) => node.label === label);
  const change = field?.onChangeText ?? field?.onChange;
  if (!change) throw new Error(`Missing field ${label}`);
  change(value);
}
function validTraining() {
  fill("events.titleField", " Training ");
  fill("events.startTime", "2026-09-10T10:00:00.000Z");
  fill("events.endTime", "2026-09-10T12:00:00.000Z");
}
function submit() {
  const button = render().find((node) => node.label === "events.create" && node.onPress);
  if (!button?.onPress) throw new Error("Missing submit button");
  button.onPress();
}

describe("dedicated event creation screen", () => {
  beforeEach(() => {
    vi.resetAllMocks(); harness.states = []; harness.refs = []; harness.started = false;
    harness.getTeamHome.mockResolvedValue({ current_membership: { role: "admin" }, team: { name: "Route team" } });
    harness.createEvent.mockResolvedValue({ id: "created-event" });
    harness.createMatch.mockResolvedValue({ id: "created-match" });
    harness.uuid.mockReturnValue("client-id");
  });

  test("does not expose the form before permission checks or to a member", async () => {
    harness.getTeamHome.mockResolvedValue({ current_membership: { role: "member" }, team: { name: "Route team" } });
    expect(render().some((node) => node.label === "events.titleField")).toBe(false);
    await flush();
    expect(render().some((node) => node.label === "events.titleField")).toBe(false);
    expect(harness.createEvent).not.toHaveBeenCalled();
  });

  test("validates required dates and schedule before creating in the route's team", async () => {
    await start(); submit(); await flush();
    expect(harness.createEvent).not.toHaveBeenCalled();
    validTraining(); fill("events.endTime", "2026-09-10T09:00:00Z"); submit();
    expect(render().some((node) => node.message === "events.invalidSchedule")).toBe(true);
    fill("events.endTime", "2026-09-10T12:00:00Z"); submit(); await flush();
    expect(harness.createEvent).toHaveBeenCalledWith("team-from-route", expect.objectContaining({ title: "Training", id: "client-id", end_time: "2026-09-10T12:00:00.000Z" }));
    expect(harness.replace).toHaveBeenCalledWith({ pathname: "/events/[eventId]", params: { eventId: "created-event" } });
  });

  test("match requires an opponent and submits match details", async () => {
    await start(); validTraining();
    render().find((node) => node.options && node.onChange)?.onChange?.("match");
    submit(); await flush(); expect(harness.createMatch).not.toHaveBeenCalled();
    fill("events.opponent", " Visitors "); fill("events.matchNotes", " Friendly ");
    submit(); await flush();
    expect(harness.createMatch).toHaveBeenCalledWith("team-from-route", expect.objectContaining({ match_details: { opponent: "Visitors", notes: "Friendly" } }));
    expect(harness.replace).toHaveBeenCalledWith({ pathname: "/events/[eventId]", params: { eventId: "created-match" } });
  });

  test("prevents double submission and reuses the UUID after a failed request", async () => {
    await start(); validTraining();
    harness.createEvent.mockRejectedValueOnce(new Error("timeout"));
    submit(); submit(); await flush();
    expect(harness.createEvent).toHaveBeenCalledTimes(1);
    expect(harness.replace).not.toHaveBeenCalled();
    submit(); await flush();
    expect(harness.createEvent).toHaveBeenCalledTimes(2);
    expect(harness.createEvent.mock.calls[0][1]).toEqual(harness.createEvent.mock.calls[1][1]);
    expect(harness.uuid).toHaveBeenCalledOnce();
  });
});
