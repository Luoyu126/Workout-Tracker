import { apiRequest } from "@/lib/api/client";
import { generateClientUuid } from "@/lib/uuid";
import { normalizeRequiredText } from "@/lib/validation/text";

export type NotificationType =
  | "new_event"
  | "event_updated"
  | "event_deleted"
  | "coin_earned"
  | "redemption_completed"
  | "team_announcement";

export type Notification = {
  id: string;
  user_id: string;
  team_id: string;
  type: NotificationType;
  title: string;
  body: string;
  reference_type: string | null;
  reference_id: string | null;
  read_at: string | null;
  created_at: string;
  expires_at: string | null;
};

export type DevicePlatform = "ios" | "android";

export type DeviceToken = {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export function getNotifications(options?: {
  teamId?: string | null;
  type?: NotificationType | null;
  unreadOnly?: boolean;
}) {
  const params = new URLSearchParams();
  if (options?.teamId) {
    params.set("team_id", options.teamId);
  }
  if (options?.type) {
    params.set("type", options.type);
  }
  if (options?.unreadOnly) {
    params.set("unread_only", "true");
  }
  const query = params.toString();
  return apiRequest<Notification[]>(`/api/v1/notifications${query ? `?${query}` : ""}`);
}

export function markNotificationRead(notificationId: string) {
  return apiRequest<Notification>(`/api/v1/notifications/${notificationId}/read`, {
    method: "POST"
  });
}

export function getUnreadCount(options?: { teamId?: string | null }) {
  const params = new URLSearchParams();
  if (options?.teamId) {
    params.set("team_id", options.teamId);
  }
  const query = params.toString();
  return apiRequest<{ count: number }>(`/api/v1/notifications/unread-count${query ? `?${query}` : ""}`);
}

export function createTeamAnnouncement(teamId: string, input: { id?: string; title: string; body: string }) {
  return apiRequest<Notification[]>(`/api/v1/teams/${teamId}/announcements`, {
    method: "POST",
    body: {
      id: input.id ?? generateClientUuid(),
      title: normalizeRequiredText(input.title) ?? input.title,
      body: normalizeRequiredText(input.body) ?? input.body
    }
  });
}

export function registerDeviceToken(token: string, platform: DevicePlatform) {
  return apiRequest<DeviceToken>("/api/v1/device-tokens", {
    method: "PUT",
    body: { token: token.trim(), platform }
  });
}

export function deactivateDeviceToken(deviceTokenId: string) {
  return apiRequest<void>(`/api/v1/device-tokens/${deviceTokenId}`, {
    method: "DELETE"
  });
}
