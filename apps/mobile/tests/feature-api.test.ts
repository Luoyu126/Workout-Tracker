import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const apiRequestMock = vi.hoisted(() => vi.fn(async () => ({})));
const authSession = vi.hoisted(() => ({ access_token: "test-access-token" }));
type AuthResult = { data?: { session: typeof authSession | null }; error: Error | null };
const signUpMock = vi.hoisted(() =>
  vi.fn<() => Promise<AuthResult>>(async () => ({ data: { session: authSession }, error: null }))
);
const signInWithPasswordMock = vi.hoisted(() =>
  vi.fn<() => Promise<AuthResult>>(async () => ({ data: { session: authSession }, error: null }))
);
const signOutMock = vi.hoisted(() => vi.fn<() => Promise<{ error: Error | null }>>(async () => ({ error: null })));

vi.mock("@/lib/api/client", () => ({
  apiRequest: apiRequestMock
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: signUpMock,
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock
    }
  }
}));

describe("feature API contracts", () => {
  beforeEach(() => {
    apiRequestMock.mockReset().mockResolvedValue({});
    signUpMock.mockReset().mockResolvedValue({ data: { session: authSession }, error: null });
    signInWithPasswordMock.mockReset().mockResolvedValue({ data: { session: authSession }, error: null });
    signOutMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("team APIs call expected endpoints", async () => {
    const {
      addTeamMember,
      getMemberCandidates,
      getMyOrganizations,
      getMyTeams,
      getTeamHome,
      getTeamMember,
      getTeamMembers,
      updateTeam,
      updateTeamMember
    } = await import("../src/features/teams/api");

    getMyOrganizations();
    getMyTeams();
    getMyTeams({ status: "archived" });
    getTeamHome("team-1");
    updateTeam("team-1", {
      name: " 新球队名 ",
      description: " 新的球队简介 ",
      logo_url: "   ",
      status: "archived"
    });
    getTeamMembers("team-1", { role: "captain", status: "active" });
    getTeamMember("team-1", "user-1");
    getMemberCandidates("team-1", " player@example.com ", 12);
    addTeamMember("team-1", {
      user_id: " user-1 ",
      role: "member",
      jersey_number: " 9 ",
      position: " 前锋 ",
      status: "active"
    });
    updateTeamMember("team-1", "user-1", {
      role: "captain",
      jersey_number: "   ",
      position: " 中场 ",
      status: "active",
      left_at: null
    });

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/organizations");
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/v1/teams");
    expect(apiRequestMock).toHaveBeenNthCalledWith(3, "/api/v1/teams?status=archived");
    expect(apiRequestMock).toHaveBeenNthCalledWith(4, "/api/v1/teams/team-1/home");
    expect(apiRequestMock).toHaveBeenNthCalledWith(5, "/api/v1/teams/team-1", {
      method: "PATCH",
      body: {
        name: "新球队名",
        description: "新的球队简介",
        logo_url: null,
        status: "archived"
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(6, "/api/v1/teams/team-1/members?role=captain&status=active");
    expect(apiRequestMock).toHaveBeenNthCalledWith(7, "/api/v1/teams/team-1/members/user-1");
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      8,
      "/api/v1/teams/team-1/member-candidates?query=player%40example.com&limit=12"
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(9, "/api/v1/teams/team-1/members", {
      method: "POST",
      body: {
        user_id: "user-1",
        role: "member",
        jersey_number: "9",
        position: "前锋",
        status: "active"
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(10, "/api/v1/teams/team-1/members/user-1", {
      method: "PATCH",
      body: {
        role: "captain",
        jersey_number: null,
        position: "中场",
        status: "active",
        left_at: null
      }
    });
  });

  test("event signup APIs preserve not-going note rule", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
        .mockReturnValueOnce("55555555-5555-4555-8555-555555555555")
    });
    const {
      createEvent,
      createMatch,
      deleteEvent,
      getEvent,
      getEventSignups,
      getMySignup,
      getTeamEvents,
      publishEvent,
      updateEvent,
      updateMySignup
    } = await import("../src/features/events/api");
    const eventInput = {
      type: "training" as const,
      title: " 周末训练 ",
      description: " 控球训练 ",
      location: "   ",
      start_time: "2026-08-16T19:00:00.000Z",
      end_time: "2026-08-16T21:00:00.000Z",
      signup_deadline: "2026-08-16T12:00:00.000Z"
    };

    getTeamEvents("team-1");
    getTeamEvents("team-1", {
      type: "match",
      status: "published",
      startsAfter: "2026-08-01T00:00:00.000Z",
      startsBefore: "2026-08-31T23:59:59.000Z"
    });
    createEvent("team-1", eventInput);
    createMatch("team-1", {
      event: { ...eventInput, type: "match" },
      match_details: { opponent: " 对手球队 ", notes: "   " }
    });
    getEvent("event-1");
    updateEvent("event-1", {
      title: " 周末训练更新 ",
      location: " 主球场 ",
      description: "   ",
      match_details: {
        opponent: " 新对手 ",
        team_score: 2,
        opponent_score: 1,
        result: "win",
        notes: " 赛后确认 "
      }
    });
    publishEvent("event-1");
    deleteEvent("event-1");
    getMySignup("event-1");
    getEventSignups("event-1");
    getEventSignups("event-1", "going");
    updateMySignup("event-1", "going");
    updateMySignup("event-1", "not_going");
    updateMySignup("event-1", "not_going", "受伤");

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/teams/team-1/events");
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/teams/team-1/events?type=match&status=published&starts_after=2026-08-01T00%3A00%3A00.000Z&starts_before=2026-08-31T23%3A59%3A59.000Z"
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(3, "/api/v1/teams/team-1/events", {
      method: "POST",
      body: {
        id: "44444444-4444-4444-8444-444444444444",
        type: "training",
        title: "周末训练",
        description: "控球训练",
        location: null,
        start_time: "2026-08-16T19:00:00.000Z",
        end_time: "2026-08-16T21:00:00.000Z",
        signup_deadline: "2026-08-16T12:00:00.000Z"
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(4, "/api/v1/teams/team-1/matches", {
      method: "POST",
      body: {
        event: {
          id: "55555555-5555-4555-8555-555555555555",
          type: "match",
          title: "周末训练",
          description: "控球训练",
          location: null,
          start_time: "2026-08-16T19:00:00.000Z",
          end_time: "2026-08-16T21:00:00.000Z",
          signup_deadline: "2026-08-16T12:00:00.000Z"
        },
        match_details: { opponent: "对手球队", notes: null }
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(5, "/api/v1/events/event-1");
    expect(apiRequestMock).toHaveBeenNthCalledWith(6, "/api/v1/events/event-1", {
      method: "PATCH",
      body: {
        title: "周末训练更新",
        description: null,
        location: "主球场",
        match_details: {
          opponent: "新对手",
          team_score: 2,
          opponent_score: 1,
          result: "win",
          notes: "赛后确认"
        }
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(7, "/api/v1/events/event-1/publish", {
      method: "POST"
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(8, "/api/v1/events/event-1", {
      method: "DELETE"
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(9, "/api/v1/events/event-1/signup");
    expect(apiRequestMock).toHaveBeenNthCalledWith(10, "/api/v1/events/event-1/signups");
    expect(apiRequestMock).toHaveBeenNthCalledWith(11, "/api/v1/events/event-1/signups?status=going");
    expect(apiRequestMock).toHaveBeenNthCalledWith(12, "/api/v1/events/event-1/signup", {
      method: "PUT",
      body: { status: "going", note: null }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(13, "/api/v1/events/event-1/signup", {
      method: "PUT",
      body: { status: "not_going", note: null }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(14, "/api/v1/events/event-1/signup", {
      method: "PUT",
      body: { status: "not_going", note: "受伤" }
    });
  });

  test("event completion and signup board APIs call expected endpoints", async () => {
    const { completeEvent } = await import("../src/features/events/api");
    const { getTeamSignupBoard } = await import("../src/features/teams/api");

    getTeamSignupBoard("team-1", {
      startsAfter: "2026-08-01T00:00:00.000Z",
      startsBefore: "2026-08-31T23:59:59.000Z"
    });
    completeEvent("event-1");
    completeEvent("event-1", {
      match_details: {
        team_score: 2,
        opponent_score: 1,
        result: "win",
        notes: "  终场确认  "
      }
    });

    expect(apiRequestMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/teams/team-1/signup-board?starts_after=2026-08-01T00%3A00%3A00.000Z&starts_before=2026-08-31T23%3A59%3A59.000Z"
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/v1/events/event-1/complete", {
      method: "POST"
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(3, "/api/v1/events/event-1/complete", {
      method: "POST",
      body: {
        match_details: {
          team_score: 2,
          opponent_score: 1,
          result: "win",
          notes: "终场确认"
        }
      }
    });
  });

  test("coin APIs call expected endpoints and rule bodies", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("66666666-6666-4666-8666-666666666666")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
    });
    const {
      createCoinRule,
      createManualCoinTransaction,
      getCoinBalance,
      getMemberCoinTransactions,
      getMyCoinTransactions,
      getCoinRules,
      updateCoinRule
    } = await import("../src/features/coins/api");
    const ruleInput = {
      name: "训练报名奖励",
      trigger_type: "training_signup" as const,
      amount: 10,
      config: null,
      is_active: true
    };

    getCoinBalance("team-1");
    getMyCoinTransactions("team-1", {
      type: "other_reward",
      createdAfter: "2026-08-01T00:00:00.000Z",
      createdBefore: "2026-08-31T23:59:59.000Z"
    });
    getMemberCoinTransactions("team-1", "user-1", { type: "admin_adjustment" });
    getCoinRules("team-1");
    createCoinRule("team-1", ruleInput);
    updateCoinRule("rule-1", { name: "训练报名奖励", amount: 12, is_active: true });
    createManualCoinTransaction("team-1", {
      user_id: "user-1",
      amount: -5,
      type: "other_reward",
      reason: "纪律扣分",
      metadata: { source: "test" }
    });

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/teams/team-1/coins/balance");
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/teams/team-1/coins/transactions?type=other_reward&created_after=2026-08-01T00%3A00%3A00.000Z&created_before=2026-08-31T23%3A59%3A59.000Z"
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/teams/team-1/members/user-1/coin-transactions?type=admin_adjustment"
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(4, "/api/v1/teams/team-1/coin-rules");
    expect(apiRequestMock).toHaveBeenNthCalledWith(5, "/api/v1/teams/team-1/coin-rules", {
      method: "POST",
      body: {
        ...ruleInput,
        id: "66666666-6666-4666-8666-666666666666"
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(6, "/api/v1/coin-rules/rule-1", {
      method: "PATCH",
      body: { name: "训练报名奖励", amount: 12, is_active: true }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(7, "/api/v1/teams/team-1/coin-transactions", {
      method: "POST",
      body: {
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "user-1",
        amount: -5,
        type: "other_reward",
        reason: "纪律扣分",
        metadata: { source: "test" }
      }
    });
  });

  test("match APIs call expected endpoints", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "33333333-3333-4333-8333-333333333333")
    });
    const { createMatchLog, deleteMatchLog, getLiveBoard, getMatchLogs, getMatchSummary } =
      await import("../src/features/events/matchApi");
    const input = {
      entry_type: "goal" as const,
      minute: 18,
      player_name: "小陈",
      player_number: "9"
    };

    getLiveBoard("event-1");
    getMatchLogs("event-1");
    getMatchLogs("event-1", "log-1");
    createMatchLog("event-1", input);
    deleteMatchLog("log-1");
    getMatchSummary("event-1");

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/events/event-1/live-board");
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/v1/events/event-1/match-logs");
    expect(apiRequestMock).toHaveBeenNthCalledWith(3, "/api/v1/events/event-1/match-logs?after=log-1");
    expect(apiRequestMock).toHaveBeenNthCalledWith(4, "/api/v1/events/event-1/match-logs", {
      method: "POST",
      body: {
        ...input,
        id: "33333333-3333-4333-8333-333333333333"
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(5, "/api/v1/match-logs/log-1", {
      method: "DELETE"
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(6, "/api/v1/events/event-1/summary");
  });

  test("store APIs call expected endpoints and redemption body shape", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
    });
    const {
      cancelRedemption,
      createStoreItem,
      fulfillRedemption,
      getMyRedemptions,
      getStoreItem,
      getStoreItems,
      getTeamRedemptions,
      redeemStoreItem,
      refundRedemption,
      updateStoreItem
    } = await import("../src/features/store/api");
    const itemInput = {
      name: " 队服 ",
      description: " 训练队服兑换 ",
      image_url: "   ",
      price: 50,
      stock: 10,
      is_active: true
    };

    getStoreItems("team-1", { isActive: false });
    createStoreItem("team-1", itemInput);
    getStoreItem("item-1");
    updateStoreItem("item-1", {
      description: "   ",
      image_url: " https://cdn.example.test/new-kit.png ",
      stock: 11,
      is_active: false
    });
    redeemStoreItem("team-1", "item-1", 2);
    redeemStoreItem("team-1", "item-1", 1, "custom-redemption-id");
    getMyRedemptions("team-1", { status: "pending" });
    getTeamRedemptions("team-1", { status: "fulfilled" });
    fulfillRedemption("redemption-1");
    cancelRedemption("redemption-1");
    refundRedemption("redemption-1");

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/teams/team-1/store-items?is_active=false");
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/v1/teams/team-1/store-items", {
      method: "POST",
      body: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "队服",
        description: "训练队服兑换",
        image_url: null,
        price: 50,
        stock: 10,
        is_active: true
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(3, "/api/v1/store-items/item-1");
    expect(apiRequestMock).toHaveBeenNthCalledWith(4, "/api/v1/store-items/item-1", {
      method: "PATCH",
      body: {
        description: null,
        image_url: "https://cdn.example.test/new-kit.png",
        stock: 11,
        is_active: false
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(5, "/api/v1/teams/team-1/redemptions", {
      method: "POST",
      body: {
        id: "22222222-2222-4222-8222-222222222222",
        store_item_id: "item-1",
        quantity: 2
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(6, "/api/v1/teams/team-1/redemptions", {
      method: "POST",
      body: {
        id: "custom-redemption-id",
        store_item_id: "item-1",
        quantity: 1
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(7, "/api/v1/teams/team-1/redemptions?status=pending");
    expect(apiRequestMock).toHaveBeenNthCalledWith(8, "/api/v1/teams/team-1/redemptions/manage?status=fulfilled");
    expect(apiRequestMock).toHaveBeenNthCalledWith(9, "/api/v1/redemptions/redemption-1/fulfill", {
      method: "POST"
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(10, "/api/v1/redemptions/redemption-1/cancel", {
      method: "POST"
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(11, "/api/v1/redemptions/redemption-1/refund", {
      method: "POST"
    });
  });

  test("notification APIs call expected endpoints", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "77777777-7777-4777-8777-777777777777")
    });
    const {
      createTeamAnnouncement,
      deactivateDeviceToken,
      getNotifications,
      getUnreadCount,
      markNotificationRead,
      registerDeviceToken
    } = await import("../src/features/notifications/api");

    getNotifications();
    getNotifications({ unreadOnly: true });
    getNotifications({ teamId: "team-1", type: "new_event", unreadOnly: true });
    getUnreadCount();
    getUnreadCount({ teamId: "team-1" });
    markNotificationRead("notification-1");
    createTeamAnnouncement("team-1", { title: " 今晚训练 ", body: " 19:00 集合 " });
    registerDeviceToken(" ExponentPushToken[test] ", "ios");
    deactivateDeviceToken("device-token-1");

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/notifications");
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/v1/notifications?unread_only=true");
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/notifications?team_id=team-1&type=new_event&unread_only=true"
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(4, "/api/v1/notifications/unread-count");
    expect(apiRequestMock).toHaveBeenNthCalledWith(5, "/api/v1/notifications/unread-count?team_id=team-1");
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/notifications/notification-1/read",
      { method: "POST" }
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(7, "/api/v1/teams/team-1/announcements", {
      method: "POST",
      body: {
        id: "77777777-7777-4777-8777-777777777777",
        title: "今晚训练",
        body: "19:00 集合"
      }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(8, "/api/v1/device-tokens", {
      method: "PUT",
      body: { token: "ExponentPushToken[test]", platform: "ios" }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(9, "/api/v1/device-tokens/device-token-1", {
      method: "DELETE"
    });
  });

  test("auth APIs delegate to Supabase and backend endpoints", async () => {
    const { getMyProfile, signIn, signOut, signUp, syncProfile, updateProfile } = await import(
      "../src/features/auth/api"
    );

    await expect(signUp({ email: " player@example.com ", password: " secret " })).resolves.toBe(authSession);
    await expect(signIn({ email: " player@example.com ", password: " secret " })).resolves.toBe(authSession);
    await signOut();
    syncProfile({ name: " 小陈 ", student_id: " 9 ", avatar_url: "   " });
    updateProfile({ name: " 小陈 2 ", student_id: "   ", avatar_url: " https://cdn.example.test/avatar.png " });
    getMyProfile();

    expect(signUpMock).toHaveBeenCalledWith({
      email: "player@example.com",
      password: "secret"
    });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "player@example.com",
      password: "secret"
    });
    expect(signOutMock).toHaveBeenCalledWith();
    expect(apiRequestMock).toHaveBeenNthCalledWith(1, "/api/v1/auth/sync", {
      method: "POST",
      body: { name: "小陈", student_id: "9", avatar_url: null }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(2, "/api/v1/users/me", {
      method: "PATCH",
      body: { name: "小陈 2", student_id: null, avatar_url: "https://cdn.example.test/avatar.png" }
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(3, "/api/v1/users/me");
  });

  test("auth APIs reject blank credentials before calling Supabase", async () => {
    const { AuthValidationError, signIn, signUp } = await import("../src/features/auth/api");

    await expect(signUp({ email: "   ", password: "secret" })).rejects.toBeInstanceOf(AuthValidationError);
    await expect(signIn({ email: "player@example.com", password: "   " })).rejects.toBeInstanceOf(AuthValidationError);

    expect(signUpMock).not.toHaveBeenCalled();
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  test("sign-up exposes an email-verification session gap", async () => {
    signUpMock.mockResolvedValueOnce({ data: { session: null }, error: null });
    const { signUp } = await import("../src/features/auth/api");

    await expect(signUp({ email: "player@example.com", password: "secret" })).resolves.toBeNull();
  });

  test("auth APIs surface Supabase auth errors for login and signup forms", async () => {
    const signInError = new Error("Invalid login credentials");
    const signUpError = new Error("Email already registered");
    const signOutError = new Error("Session revoke failed");
    const { signIn, signOut, signUp } = await import("../src/features/auth/api");

    signInWithPasswordMock.mockResolvedValueOnce({ error: signInError });
    await expect(signIn({ email: "player@example.com", password: "secret" })).rejects.toBe(signInError);

    signUpMock.mockResolvedValueOnce({ error: signUpError });
    await expect(signUp({ email: "player@example.com", password: "secret" })).rejects.toBe(signUpError);

    signOutMock.mockResolvedValueOnce({ error: signOutError });
    await expect(signOut()).rejects.toBe(signOutError);
  });
});
