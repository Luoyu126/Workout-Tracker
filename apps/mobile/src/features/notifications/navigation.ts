import type { Href } from "expo-router";

type NotificationData = Record<string, unknown> | undefined;

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getNotificationRoute(data: NotificationData): Href | null {
  const type = asString(data?.type);
  const referenceType = asString(data?.referenceType) ?? asString(data?.reference_type);
  const referenceId = asString(data?.referenceId) ?? asString(data?.reference_id);
  const teamId = asString(data?.teamId) ?? asString(data?.team_id);

  if (referenceType === "event" && referenceId) {
    return {
      pathname: "/events/[eventId]",
      params: { eventId: referenceId }
    };
  }

  if ((referenceType === "event_snapshot" || type === "event_deleted") && teamId) {
    return {
      pathname: "/inbox",
      params: { teamId }
    };
  }

  if ((referenceType === "coin_transaction" || type === "coin_earned") && teamId) {
    return {
      pathname: "/teams/[teamId]/coins",
      params: { teamId }
    };
  }

  if ((referenceType === "redemption" || type === "redemption_completed") && teamId) {
    return {
      pathname: "/teams/[teamId]/store",
      params: { teamId }
    };
  }

  if ((referenceType === "team" || referenceType === "team_announcement" || type === "team_announcement") && teamId) {
    return {
      pathname: "/teams/[teamId]",
      params: { teamId }
    };
  }

  if (teamId) {
    return {
      pathname: "/inbox",
      params: { teamId }
    };
  }

  return "/inbox";
}
