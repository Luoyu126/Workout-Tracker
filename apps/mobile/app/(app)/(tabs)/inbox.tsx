import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Badge, Button, Card, EmptyState, Screen, SegmentedControl, TextField } from "@/components/ui";
import { getMySignup, type EventSignup, type SignupStatus } from "@/features/events/api";
import {
  createTeamAnnouncement,
  deactivateDeviceToken,
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  registerDeviceToken,
  type DevicePlatform,
  type DeviceToken,
  type Notification
} from "@/features/notifications/api";
import {
  getDefaultDevicePlatform,
  normalizeExpoPushToken,
  requestExpoPushTokenAsync
} from "@/features/notifications/deviceToken";
import { getMyTeams, type Team } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useTeamContext } from "@/providers/TeamProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

function isActionableEventNotification(
  notification: Notification
): notification is Notification & { reference_type: "event"; reference_id: string } {
  return notification.reference_type === "event" && notification.reference_id !== null;
}

function relativeTime(iso: string, locale: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(delta / 60000));
  if (minutes < 60) {
    return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return locale === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`;
  }
  return new Date(iso).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en");
}

function signupStatusLabel(
  status: SignupStatus | undefined,
  t: (key: TranslationKey) => string
): string {
  if (status === "going") {
    return t("inbox.signupConfirmed");
  }
  if (status === "not_going") {
    return t("inbox.signupLeave");
  }
  return t("inbox.signupPending");
}

function signupStatusTone(status: SignupStatus | undefined): "accent" | "muted" | "purple" {
  if (status === "going") {
    return "accent";
  }
  if (status === "not_going") {
    return "purple";
  }
  return "muted";
}

export default function InboxTabScreen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { selectedTeamId, role } = useTeamContext();
  const scopedTeamId = typeof teamId === "string" ? teamId : selectedTeamId;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [signupsByEventId, setSignupsByEventId] = useState<Record<string, EventSignup>>({});
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deviceToken, setDeviceToken] = useState("");
  const [devicePlatform, setDevicePlatform] = useState<DevicePlatform>(() => getDefaultDevicePlatform());
  const [registeredDeviceToken, setRegisteredDeviceToken] = useState<DeviceToken | null>(null);
  const [announcementTeams, setAnnouncementTeams] = useState<Team[]>([]);
  const [announcementTeamId, setAnnouncementTeamId] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canSendAnnouncement = role === "captain" || role === "admin";

  async function loadEventSignups(nextNotifications: Notification[]) {
    const eventIds = Array.from(
      new Set(
        nextNotifications
          .filter(isActionableEventNotification)
          .map((notification) => notification.reference_id)
      )
    );
    if (eventIds.length === 0) {
      setSignupsByEventId({});
      return;
    }
    const results = await Promise.all(
      eventIds.map(async (eventId) => {
        try {
          return [eventId, await getMySignup(eventId)] as const;
        } catch {
          return [eventId, null] as const;
        }
      })
    );
    const nextSignups: Record<string, EventSignup> = {};
    for (const [eventId, signup] of results) {
      if (signup) {
        nextSignups[eventId] = signup;
      }
    }
    setSignupsByEventId(nextSignups);
  }

  async function loadNotifications(nextUnreadOnly: boolean, options: { showEmptyMessage: boolean }) {
    const [nextNotifications, nextUnreadCount, nextAnnouncementTeams] = await Promise.all([
      getNotifications({ teamId: scopedTeamId, unreadOnly: nextUnreadOnly }),
      getUnreadCount({ teamId: scopedTeamId }),
      scopedTeamId ? Promise.resolve([]) : getMyTeams({ status: "active" })
    ]);
    setNotifications(nextNotifications);
    setUnreadCount(nextUnreadCount.count);
    setAnnouncementTeams(nextAnnouncementTeams);
    await loadEventSignups(nextNotifications);
    if (options.showEmptyMessage && nextNotifications.length === 0) {
      setMessage(t("inbox.noNotifications"));
    }
  }

  async function handleLoadNotifications() {
    setIsLoading(true);
    setMessage(null);
    try {
      await loadNotifications(unreadOnly, { showEmptyMessage: true });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void handleLoadNotifications();
  }, [scopedTeamId]);

  useEffect(() => {
    if (scopedTeamId) {
      setAnnouncementTeamId(scopedTeamId);
    }
  }, [scopedTeamId]);

  async function handleMarkRead(notificationId: string) {
    setIsLoading(true);
    setMessage(null);
    try {
      await markNotificationRead(notificationId);
      await loadNotifications(unreadOnly, { showEmptyMessage: false });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMarkAllRead() {
    setIsLoading(true);
    setMessage(null);
    try {
      const unread = notifications.filter((item) => !item.read_at);
      for (const item of unread) {
        await markNotificationRead(item.id);
      }
      await loadNotifications(unreadOnly, { showEmptyMessage: false });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRegisterDeviceToken() {
    const normalizedDeviceToken = normalizeExpoPushToken(deviceToken);
    if (normalizedDeviceToken === null) {
      setMessage(t("inbox.invalidDeviceToken"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const nextDeviceToken = await registerDeviceToken(normalizedDeviceToken, devicePlatform);
      setRegisteredDeviceToken(nextDeviceToken);
      setDeviceToken(nextDeviceToken.token);
      setMessage(t("inbox.deviceRegistered"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAutoRegisterDeviceToken() {
    setIsLoading(true);
    setMessage(null);
    try {
      const registration = await requestExpoPushTokenAsync();
      if (registration.status === "denied") {
        setMessage(t("inbox.notificationPermissionDenied"));
        return;
      }
      if (registration.status !== "registered") {
        setMessage(t("inbox.notificationUnsupported"));
        return;
      }
      const nextDeviceToken = await registerDeviceToken(registration.token, registration.platform);
      setRegisteredDeviceToken(nextDeviceToken);
      setDeviceToken(nextDeviceToken.token);
      setDevicePlatform(nextDeviceToken.platform);
      setMessage(t("inbox.deviceRegistered"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeactivateDeviceToken() {
    if (!registeredDeviceToken) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await deactivateDeviceToken(registeredDeviceToken.id);
      setRegisteredDeviceToken(null);
      setMessage(t("inbox.deviceDeactivated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateAnnouncement() {
    const normalizedTeamId = scopedTeamId ?? announcementTeamId.trim();
    const normalizedTitle = announcementTitle.trim();
    const normalizedBody = announcementBody.trim();
    if (!canSendAnnouncement) {
      setMessage(t("inbox.captainOnlyHint"));
      return;
    }
    if (!normalizedTeamId || !normalizedTitle || !normalizedBody) {
      setMessage(t("inbox.invalidAnnouncement"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await createTeamAnnouncement(normalizedTeamId, {
        title: normalizedTitle,
        body: normalizedBody
      });
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setMessage(t("inbox.announcementSent"));
      await loadNotifications(unreadOnly, { showEmptyMessage: false });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleUnreadOnly() {
    const nextUnreadOnly = !unreadOnly;
    setUnreadOnly(nextUnreadOnly);
    setIsLoading(true);
    setMessage(null);
    try {
      await loadNotifications(nextUnreadOnly, { showEmptyMessage: true });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function openNotification(notification: Notification) {
    if (!notification.read_at) {
      void handleMarkRead(notification.id);
    }
    if (isActionableEventNotification(notification)) {
      router.push({ pathname: "/events/[eventId]", params: { eventId: notification.reference_id } });
      return;
    }
    if (notification.reference_type === "coin_transaction") {
      router.push({ pathname: "/teams/[teamId]/coins", params: { teamId: notification.team_id } });
      return;
    }
    if (notification.reference_type === "redemption") {
      router.push({ pathname: "/teams/[teamId]/store", params: { teamId: notification.team_id } });
      return;
    }
    if (notification.reference_type === "team") {
      router.push({ pathname: "/teams/[teamId]", params: { teamId: notification.team_id } });
    }
  }

  return (
    <Screen
      title={`${t("inbox.title")}${unreadCount ? ` (${unreadCount})` : ""}`}
      refreshing={isLoading}
      onRefresh={() => void handleLoadNotifications()}
      headerRight={
        <Pressable accessibilityRole="button" onPress={() => void handleMarkAllRead()}>
          <Text style={styles.markAll}>{t("inbox.markAllRead")}</Text>
        </Pressable>
      }
    >
      <SegmentedControl
        value={unreadOnly ? "unread" : "all"}
        onChange={(value) => {
          if ((value === "unread") !== unreadOnly) {
            void handleToggleUnreadOnly();
          }
        }}
        options={[
          { value: "all", label: `${t("inbox.allFilter")}${unreadCount != null ? ` (${unreadCount})` : ""}` },
          { value: "unread", label: t("inbox.unreadOnly") }
        ]}
      />

      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={() => void handleLoadNotifications()}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      {notifications.length === 0 && !isLoading ? <EmptyState title={t("inbox.noNotifications")} /> : null}

      {notifications.map((notification) => {
        const eventSignup = isActionableEventNotification(notification)
          ? signupsByEventId[notification.reference_id]
          : undefined;
        const signupStatus = eventSignup?.status;

        return (
          <Card key={notification.id} style={!notification.read_at ? styles.unreadCard : undefined}>
            <Pressable accessibilityRole="button" onPress={() => openNotification(notification)}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{notification.title}</Text>
                <Text style={styles.muted}>{relativeTime(notification.created_at, locale)}</Text>
              </View>
              <Text style={styles.body}>{notification.body}</Text>
              <View style={styles.rowBetween}>
                <Badge label={t(`inbox.type.${notification.type}`)} tone={notification.read_at ? "muted" : "accent"} />
                <Text style={styles.muted}>{notification.read_at ? t("inbox.read") : t("inbox.unread")}</Text>
              </View>
              {isActionableEventNotification(notification) ? (
                <View style={styles.signupStatus}>
                  <Text style={styles.muted}>{t("inbox.mySignup")}</Text>
                  <Badge label={signupStatusLabel(signupStatus, t)} tone={signupStatusTone(signupStatus)} />
                  {signupStatus === "not_going" && eventSignup?.note ? (
                    <Text style={styles.leaveReason}>{eventSignup.note}</Text>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          </Card>
        );
      })}

      {canSendAnnouncement ? (
        <Card>
          <Text style={styles.cardTitle}>{t("inbox.announcementTitle")}</Text>
          {!scopedTeamId ? (
            <View style={styles.row}>
              {announcementTeams.map((team) => (
                <Pressable
                  accessibilityRole="button"
                  key={team.id}
                  onPress={() => setAnnouncementTeamId(team.id)}
                  style={[styles.teamChip, announcementTeamId === team.id && styles.teamChipActive]}
                >
                  <Text style={styles.teamChipText}>{team.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextField label={t("inbox.announcementSubject")} onChangeText={setAnnouncementTitle} value={announcementTitle} />
          <TextField
            label={t("inbox.announcementBody")}
            multiline
            onChangeText={setAnnouncementBody}
            value={announcementBody}
          />
          <Button disabled={isLoading} label={t("inbox.sendAnnouncement")} onPress={() => void handleCreateAnnouncement()} />
        </Card>
      ) : null}

      <Button
        label={showSettings ? t("inbox.hideDeviceSettings") : t("profile.notificationSettings")}
        variant="secondary"
        onPress={() => setShowSettings((value) => !value)}
      />
      {showSettings ? (
        <Card>
          <Text style={styles.cardTitle}>{t("inbox.pushDevice")}</Text>
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label={t("inbox.deviceToken")}
            onChangeText={setDeviceToken}
            value={deviceToken}
          />
          <SegmentedControl
            value={devicePlatform}
            onChange={setDevicePlatform}
            options={[
              { value: "ios", label: "ios" },
              { value: "android", label: "android" }
            ]}
          />
          <Button disabled={isLoading} label={t("inbox.autoRegisterDevice")} onPress={() => void handleAutoRegisterDeviceToken()} />
          <Button
            disabled={isLoading}
            label={t("inbox.registerDevice")}
            variant="secondary"
            onPress={() => void handleRegisterDeviceToken()}
          />
          {registeredDeviceToken ? (
            <Button
              disabled={isLoading}
              label={t("inbox.deactivateDevice")}
              variant="danger"
              onPress={() => void handleDeactivateDeviceToken()}
            />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: {
    color: colors.accentSoft,
    fontWeight: "700"
  },
  unreadCard: {
    borderColor: colors.accent
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  cardTitle: {
    color: colors.text,
    flex: 1,
    ...typography.section
  },
  body: {
    color: colors.text,
    ...typography.body
  },
  muted: {
    color: colors.muted,
    ...typography.caption
  },
  signupStatus: {
    gap: spacing.xs,
    marginTop: spacing.sm
  },
  leaveReason: {
    color: colors.text,
    ...typography.caption
  },
  teamChip: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  teamChipActive: {
    backgroundColor: colors.accent
  },
  teamChipText: {
    color: colors.text,
    fontWeight: "700"
  }
});
