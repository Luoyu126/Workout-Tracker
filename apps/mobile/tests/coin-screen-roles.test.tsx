import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, started: false,
  team: vi.fn(), balance: vi.fn(), transactions: vi.fn(), memberTransactions: vi.fn(), rules: vi.fn(), members: vi.fn(), update: vi.fn(), adjust: vi.fn()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }];
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
  useLocalSearchParams: () => ({ teamId: "team" })
}));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/components/ui/DateTimeField", () => ({ DateTimeField: "date" }));
vi.mock("@/features/teams/api", () => ({ getTeamHome: h.team, getTeamMembers: h.members }));
vi.mock("@/features/coins/api", () => ({
  getCoinBalance: h.balance, getMyCoinTransactions: h.transactions, getMemberCoinTransactions: h.memberTransactions,
  getCoinRules: h.rules, updateCoinRule: h.update, createCoinRule: vi.fn(), createManualCoinTransaction: h.adjust
}));
vi.mock("@/lib/uuid", () => ({ generateClientUuid: () => "client-id" }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "request failed" }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import Coins from "../app/(app)/teams/[teamId]/coins";

type Props = { children?: ReactNode; loadState?: { status: string; error?: unknown }; onPress?: () => Promise<void> };
function nodes(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<Props>(node) ? text(node.props.children) : "";
}
function render() { h.index = 0; return Coins(); }
async function load() {
  render();
  for (let index = 0; index < 20; index++) await Promise.resolve();
  return render();
}
beforeEach(() => {
  vi.resetAllMocks(); h.states = []; h.started = false;
  h.team.mockResolvedValue({ current_membership: { role: "admin" } });
  h.balance.mockResolvedValue({ balance: 100 });
  h.transactions.mockResolvedValue([]);
  h.members.mockResolvedValue([{ user_id: "11111111-1111-4111-8111-111111111111", status: "active", user: { name: "Player" } }]);
  h.rules.mockResolvedValue([{ id: "training-rule", trigger_type: "training_signup", amount: 10, is_active: true }]);
});
test("admin automatically loads rules without balance or ledger sections and requests", async () => {
  const ui = await load();
  expect(h.rules).toHaveBeenCalledWith("team");
  for (const key of ["coins.captainOnlyHint", "coins.load", "coins.myBalance", "coins.myTransactions", "coins.memberTransactions", "coins.loadMemberTransactions"]) {
    expect(text(ui)).not.toContain(key);
  }
  expect(text(ui)).toContain("coins.training");
  expect(text(ui)).toContain("coins.match");
  expect(text(ui)).toContain("coins.manualAdjustment");
  expect(h.balance).not.toHaveBeenCalled();
  expect(h.transactions).not.toHaveBeenCalled();
  expect(h.memberTransactions).not.toHaveBeenCalled();
});
test("saving rules and selecting a member for manual adjustment do not fetch removed ledgers", async () => {
  const ui = await load();
  await nodes(ui).find((node) => node.onPress && text(node.children) === "coins.saveRule")?.onPress?.();
  expect(h.update).toHaveBeenCalledWith("training-rule", expect.objectContaining({ amount: 10 }));
  await nodes(render()).find((node) => node.onPress && text(node.children).includes("Player"))?.onPress?.();
  await nodes(render()).find((node) => node.onPress && text(node.children) === "coins.createAdjustment")?.onPress?.();
  expect(h.adjust).toHaveBeenCalledWith("team", expect.objectContaining({ user_id: "11111111-1111-4111-8111-111111111111", amount: 10 }));
  expect(h.balance).not.toHaveBeenCalled();
  expect(h.transactions).not.toHaveBeenCalled();
  expect(h.memberTransactions).not.toHaveBeenCalled();
});
test("member retains their balance and transaction history", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  const ui = await load();
  expect(text(ui)).toContain("coins.myBalance");
  expect(text(ui)).toContain("coins.myTransactions");
  expect(h.balance).toHaveBeenCalledWith("team");
  expect(h.transactions).toHaveBeenCalledOnce();
  expect(h.rules).toHaveBeenCalledWith("team");
  expect(h.members).not.toHaveBeenCalled();
});

test("member sees active training and match rewards as read-only, including zero amounts", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  h.rules.mockResolvedValue([
    { id: "training", trigger_type: "training_signup", amount: 0, is_active: true },
    { id: "match", trigger_type: "match_signup", amount: 37, is_active: true },
    { id: "old-match", trigger_type: "match_signup", amount: 99, is_active: false }
  ]);
  const content = text(await load());
  for (const label of ["coins.rules", "coins.training", "coins.match", "0 coins.unit", "37 coins.unit"]) {
    expect(content).toContain(label);
  }
  for (const label of ["coins.captainOnlyHint", "coins.saveRule", "coins.manualAdjustment", "99 coins.unit", "coins.ruleNotConfigured"]) {
    expect(content).not.toContain(label);
  }
});

test("member sees unconfigured rules only after a successful response", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  h.rules.mockResolvedValue([{ trigger_type: "training_signup", amount: 10, is_active: false }]);
  const content = text(await load());
  expect(content.match(/coins.ruleNotConfigured/g)).toHaveLength(2);
  expect(content).not.toContain("10 coins.unit");
});

test("rule load failure remains an error without showing unconfigured or default amounts", async () => {
  h.team.mockResolvedValue({ current_membership: { role: "member" } });
  const error = new Error("unavailable");
  h.rules.mockRejectedValue(error);
  const ui = await load();
  expect(nodes(ui).find((node) => node.loadState)?.loadState).toEqual({ status: "error", error });
  expect(text(ui)).not.toContain("coins.ruleNotConfigured");
  expect(text(ui)).not.toContain("coins.rules");
  expect(h.rules).toHaveBeenCalledOnce();
});
