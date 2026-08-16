import { describe, expect, test } from "vitest";

import { getNotificationRoute } from "../src/features/notifications/navigation";

describe("notification navigation", () => {
  test("opens event notifications at the event detail route", () => {
    expect(
      getNotificationRoute({
        referenceType: "event",
        referenceId: "event-1",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/events/[eventId]",
      params: { eventId: "event-1" }
    });
  });

  test("also accepts snake_case notification fields from API-shaped objects", () => {
    expect(
      getNotificationRoute({
        reference_type: "event",
        reference_id: "event-1",
        team_id: "team-1"
      })
    ).toEqual({
      pathname: "/events/[eventId]",
      params: { eventId: "event-1" }
    });

    expect(
      getNotificationRoute({
        reference_type: "redemption",
        reference_id: "redemption-1",
        team_id: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]/store",
      params: { teamId: "team-1" }
    });
  });

  test("keeps draft event snapshot notifications in the team-scoped Inbox", () => {
    expect(
      getNotificationRoute({
        referenceType: "event_snapshot",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/inbox",
      params: { teamId: "team-1" }
    });
  });

  test("keeps deleted event push notifications in Inbox even when reference type is omitted", () => {
    expect(
      getNotificationRoute({
        type: "event_deleted",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/inbox",
      params: { teamId: "team-1" }
    });
  });

  test("opens coin and redemption notifications at team-scoped tabs", () => {
    expect(
      getNotificationRoute({
        referenceType: "coin_transaction",
        referenceId: "coin-1",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]/coins",
      params: { teamId: "team-1" }
    });

    expect(
      getNotificationRoute({
        referenceType: "redemption",
        referenceId: "redemption-1",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]/store",
      params: { teamId: "team-1" }
    });
  });

  test("falls back to notification type when push data omits referenceType", () => {
    expect(
      getNotificationRoute({
        type: "coin_earned",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]/coins",
      params: { teamId: "team-1" }
    });

    expect(
      getNotificationRoute({
        type: "redemption_completed",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]/store",
      params: { teamId: "team-1" }
    });

    expect(
      getNotificationRoute({
        type: "team_announcement",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]",
      params: { teamId: "team-1" }
    });
  });

  test("opens team announcement notifications at team home", () => {
    expect(
      getNotificationRoute({
        referenceType: "team_announcement",
        referenceId: "announcement-1",
        teamId: "team-1"
      })
    ).toEqual({
      pathname: "/teams/[teamId]",
      params: { teamId: "team-1" }
    });
  });

  test("falls back to team-scoped Inbox or global Inbox", () => {
    expect(getNotificationRoute({ teamId: "team-1" })).toEqual({
      pathname: "/inbox",
      params: { teamId: "team-1" }
    });
    expect(getNotificationRoute({})).toBe("/inbox");
    expect(getNotificationRoute(undefined)).toBe("/inbox");
  });
});
