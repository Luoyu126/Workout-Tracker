import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, effects: [] as (() => void)[], first: true,
  role: "admin", balance: vi.fn(), mine: vi.fn(), items: vi.fn(), orders: vi.fn(),
  notifications: vi.fn(), unread: vi.fn(), team: vi.fn(), item: vi.fn()
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => { if (h.first) h.effects.push(fn); }
}));
vi.mock("react-native", () => ({
  Text: "text", View: "view", Pressable: "pressable", Image: "image", ScrollView: "scroll",
  TextInput: "input", Alert: { alert: vi.fn() }, StyleSheet: { create: (value: unknown) => value }
}));
vi.mock("expo-router", () => ({
  Link: "link", useRouter: () => ({ push: vi.fn() }),
  useLocalSearchParams: () => ({ teamId: "team", storeItemId: "item" })
}));
vi.mock("@/components/ui", () => ({
  Badge: "badge", Button: "button", Card: "card", EmptyState: "empty", Screen: "screen",
  SegmentedControl: "segments", TextField: "field"
}));
vi.mock("@/components/ScreenState", () => ({ ScreenState: "state" }));
vi.mock("@/providers/TeamProvider", () => ({ useTeamContext: () => ({
  selectedTeamId: "team", role: h.role, home: { team: { name: "Team" } }, loadState: { status: "success" }
}) }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("@/lib/api/errors", () => ({ formatApiError: () => "failed" }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/uuid", () => ({ generateClientUuid: () => "uuid" }));
vi.mock("@/features/coins/api", () => ({ getCoinBalance: h.balance }));
vi.mock("@/features/store/api", () => ({
  getMyRedemptions: h.mine, getStoreItems: h.items, getTeamRedemptions: h.orders, getStoreItem: h.item,
  cancelRedemption: vi.fn(), createStoreItem: vi.fn(), fulfillRedemption: vi.fn(),
  redeemStoreItem: vi.fn(), refundRedemption: vi.fn(), updateStoreItem: vi.fn()
}));
vi.mock("@/features/teams/api", () => ({ getTeamHome: h.team, getMyTeams: vi.fn() }));
vi.mock("@/features/events/api", () => ({ getMySignup: vi.fn() }));
vi.mock("@/features/notifications/api", () => ({
  getNotifications: h.notifications, getUnreadCount: h.unread, createTeamAnnouncement: vi.fn(),
  deactivateDeviceToken: vi.fn(), markNotificationRead: vi.fn(), registerDeviceToken: vi.fn()
}));
vi.mock("@/features/notifications/deviceToken", () => ({
  getDefaultDevicePlatform: () => "ios", normalizeExpoPushToken: vi.fn(), requestExpoPushTokenAsync: vi.fn()
}));

import Store from "../app/(app)/(tabs)/store";
import Inbox from "../app/(app)/(tabs)/inbox";
import TeamStore from "../app/(app)/teams/[teamId]/store";
import Detail from "../app/(app)/store-items/[storeItemId]";

type Props = { children?: ReactNode; headerRight?: ReactNode; label?: string; title?: string; options?: { label: string }[] };
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (!isValidElement<Props>(node)) return "";
  return [node.props.label, node.props.title, ...node.props.options?.map((option) => option.label) ?? [],
    text(node.props.children), text(node.props.headerRight)].join(" ");
}
async function render(screen: () => ReactNode) {
  h.index = 0;
  const result = screen();
  if (h.first) {
    h.first = false;
    h.effects.forEach((effect) => effect());
    for (let i = 0; i < 20; i++) await Promise.resolve();
    h.index = 0;
    return text(screen());
  }
  return text(result);
}
beforeEach(() => {
  vi.clearAllMocks(); h.states = []; h.index = 0; h.effects = []; h.first = true; h.role = "admin";
  const item = { id: "item", team_id: "team", name: "Shirt", price: 10, stock: 2, is_active: true };
  h.items.mockResolvedValue([item]); h.item.mockResolvedValue(item);
  h.team.mockImplementation(async () => ({ current_membership: { role: h.role } }));
  h.mine.mockResolvedValue([]); h.orders.mockResolvedValue([]); h.balance.mockResolvedValue({ balance: 100 });
  h.notifications.mockResolvedValue([]); h.unread.mockResolvedValue({ count: 0 });
});
test.each([Store, TeamStore, Detail])("admin has no personal redemption UI in %s", async (screen) => {
  const ui = await render(screen);
  expect(ui).not.toContain("store.redeem");
  expect(ui).not.toContain("store.myRedemptions");
  expect(ui).not.toContain("store.walletBalance");
  expect(h.mine).not.toHaveBeenCalled(); expect(h.balance).not.toHaveBeenCalled();
  if (screen !== Detail) expect(ui).toContain("store.manageRedemptions");
});
test.each([Store, TeamStore, Detail])("member keeps redemption UI in %s", async (screen) => {
  h.role = "member";
  const ui = await render(screen);
  expect(ui).toContain("store.redeem"); expect(ui).not.toContain("store.manageRedemptions");
  if (screen !== Detail) { expect(ui).toContain("store.myRedemptions"); expect(h.mine).toHaveBeenCalledOnce(); }
});
test("admin inbox contains only announcement controls", async () => {
  const ui = await render(Inbox);
  expect(ui).toContain("inbox.sendAnnouncement");
  for (const key of ["inbox.allFilter", "inbox.unreadOnly", "inbox.markAllRead", "inbox.noNotifications", "profile.notificationSettings"]) {
    expect(ui).not.toContain(key);
  }
  expect(h.notifications).not.toHaveBeenCalled(); expect(h.unread).not.toHaveBeenCalled();
});
test("member inbox retains filters without device settings", async () => {
  h.role = "member";
  const ui = await render(Inbox);
  expect(ui).toContain("inbox.allFilter"); expect(ui).toContain("inbox.unreadOnly");
  expect(ui).not.toContain("profile.notificationSettings"); expect(ui).not.toContain("inbox.sendAnnouncement");
  expect(h.notifications).toHaveBeenCalledOnce(); expect(h.unread).toHaveBeenCalledOnce();
});
