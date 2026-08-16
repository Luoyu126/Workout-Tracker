import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { updateMySignup, type SignupStatus } from "@/features/events/api";
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
import { getMyTeams, getTeamHome, type MembershipRole, type Team } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

function isActionableEventNotification(
  notification: Notification
): notification is Notification & { reference_type: "event"; reference_id: string } {
  return notification.reference_type === "event" && notification.reference_id !== null;
}

export default function InboxScreen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const { t } = useI18n();
  const scopedTeamId = typeof teamId === "string" ? teamId : null;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [deviceToken, setDeviceToken] = useState("");
  const [devicePlatform, setDevicePlatform] = useState<DevicePlatform>(() => getDefaultDevicePlatform());
  const [registeredDeviceToken, setRegisteredDeviceToken] = useState<DeviceToken | null>(null);
  const [announcementTeams, setAnnouncementTeams] = useState<Team[]>([]);
  const [announcementTeamId, setAnnouncementTeamId] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [signupNotesByNotificationId, setSignupNotesByNotificationId] = useState<Record<string, string>>({});
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canSendScopedAnnouncement =
    scopedTeamId === null || currentRole === "captain" || currentRole === "admin";

  async function loadNotifications(nextUnreadOnly: boolean, options: { showEmptyMessage: boolean }) {
    const [nextNotifications, nextUnreadCount, teamHome, nextAnnouncementTeams] = await Promise.all([
      getNotifications({ teamId: scopedTeamId, unreadOnly: nextUnreadOnly }),
      getUnreadCount({ teamId: scopedTeamId }),
      scopedTeamId ? getTeamHome(scopedTeamId) : Promise.resolve(null),
      scopedTeamId ? Promise.resolve([]) : getMyTeams({ status: "active" })
    ]);
    setNotifications(nextNotifications);
    setUnreadCount(nextUnreadCount.count);
    setCurrentRole(teamHome?.current_membership.role ?? null);
    setAnnouncementTeams(nextAnnouncementTeams);
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
  }, [teamId]);

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
      if (registration.status === "unsupported") {
        setMessage(t("inbox.notificationUnsupported"));
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
    if (!canSendScopedAnnouncement) {
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

  async function handleQuickSignup(notification: Notification, status: SignupStatus) {
    if (!isActionableEventNotification(notification)) {
      return;
    }
    const note = signupNotesByNotificationId[notification.id]?.trim() ?? "";
    if (status === "not_going" && note.length === 0) {
      setMessage(t("events.signupNoteRequired"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await updateMySignup(notification.reference_id, status, status === "not_going" ? note : null);
      setSignupNotesByNotificationId((currentNotes) => ({
        ...currentNotes,
        [notification.id]: status === "not_going" ? note : ""
      }));
      setMessage(t("events.signupSaved"));
      await loadNotifications(unreadOnly, { showEmptyMessage: false });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function renderEventQuickSignup(notification: Notification) {
    if (!isActionableEventNotification(notification)) {
      return null;
    }

    return (
      <View style={styles.quickSignup}>
        <Text style={styles.muted}>{t("inbox.quickSignup")}</Text>
        <View style={styles.row}>
          {(["going", "maybe"] as const).map((status) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={status}
              onPress={() => handleQuickSignup(notification, status)}
              style={[styles.smallButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t(`events.signup.${status}`)}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          onChangeText={(nextNote) =>
            setSignupNotesByNotificationId((currentNotes) => ({
              ...currentNotes,
              [notification.id]: nextNote
            }))
          }
          placeholder={t("events.signupNote")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={signupNotesByNotificationId[notification.id] ?? ""}
        />
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => handleQuickSignup(notification, "not_going")}
          style={[styles.secondaryButton, isLoading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t("events.signup.not_going")}</Text>
        </Pressable>
      </View>
    );
  }

  function renderNotificationLink(notification: Notification) {
    if (isActionableEventNotification(notification)) {
      return (
        <Link href={{ pathname: "/events/[eventId]", params: { eventId: notification.reference_id } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("inbox.openEvent")}</Text>
          </Pressable>
        </Link>
      );
    }

    if (notification.reference_type === "event_snapshot") {
      return <Text style={styles.muted}>{t("inbox.eventSnapshotHint")}</Text>;
    }

    if (notification.reference_type === "coin_transaction") {
      return (
        <Link href={{ pathname: "/teams/[teamId]/coins", params: { teamId: notification.team_id } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("inbox.openCoins")}</Text>
          </Pressable>
        </Link>
      );
    }

    if (notification.reference_type === "redemption") {
      return (
        <Link href={{ pathname: "/teams/[teamId]/store", params: { teamId: notification.team_id } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("inbox.openStore")}</Text>
          </Pressable>
        </Link>
      );
    }

    if (notification.reference_type === "team") {
      return (
        <Link href={{ pathname: "/teams/[teamId]", params: { teamId: notification.team_id } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("inbox.openTeam")}</Text>
          </Pressable>
        </Link>
      );
    }

    return null;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("inbox.title")}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inbox.pushDevice")}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setDeviceToken}
          placeholder={t("inbox.deviceToken")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={deviceToken}
        />
        <View style={styles.row}>
          {(["ios", "android"] as const).map((platform) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={platform}
              onPress={() => setDevicePlatform(platform)}
              style={[styles.smallButton, devicePlatform === platform && styles.activeButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{platform}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleAutoRegisterDeviceToken}
          style={[styles.secondaryButton, isLoading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t("inbox.autoRegisterDevice")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleRegisterDeviceToken}
          style={[styles.secondaryButton, isLoading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t("inbox.registerDevice")}</Text>
        </Pressable>
        {registeredDeviceToken ? (
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={handleDeactivateDeviceToken}
            style={[styles.dangerButton, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("inbox.deactivateDevice")}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("inbox.announcementTitle")}</Text>
        <Text style={styles.muted}>{t("inbox.announcementHint")}</Text>
        {!canSendScopedAnnouncement ? <Text style={styles.muted}>{t("inbox.captainOnlyHint")}</Text> : null}
        {canSendScopedAnnouncement ? (
          <>
            {scopedTeamId ? (
              <Text style={styles.muted}>{t("inbox.scopedAnnouncementHint")}</Text>
            ) : (
              <>
                <Text style={styles.muted}>{t("inbox.chooseAnnouncementTeam")}</Text>
                {announcementTeams.length === 0 ? (
                  <Text style={styles.muted}>{t("inbox.noAnnouncementTeams")}</Text>
                ) : null}
                <View style={styles.row}>
                  {announcementTeams.map((team) => (
                    <Pressable
                      accessibilityRole="button"
                      disabled={isLoading}
                      key={team.id}
                      onPress={() => setAnnouncementTeamId(team.id)}
                      style={[styles.teamButton, announcementTeamId === team.id && styles.activeButton, isLoading && styles.disabled]}
                    >
                      <Text style={styles.secondaryText}>{team.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setAnnouncementTeamId}
                  placeholder={t("inbox.announcementTeamId")}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={announcementTeamId}
                />
              </>
            )}
            <TextInput
              onChangeText={setAnnouncementTitle}
              placeholder={t("inbox.announcementSubject")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={announcementTitle}
            />
            <TextInput
              multiline
              onChangeText={setAnnouncementBody}
              placeholder={t("inbox.announcementBody")}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textArea]}
              value={announcementBody}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={handleCreateAnnouncement}
              style={[styles.secondaryButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("inbox.sendAnnouncement")}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleToggleUnreadOnly}
          style={[styles.smallButton, unreadOnly && styles.activeButton, isLoading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t("inbox.unreadOnly")}</Text>
        </Pressable>
        <View style={styles.countBadge}>
          <Text style={styles.secondaryText}>
            {t("inbox.unreadCount")}: {unreadCount ?? "-"}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadNotifications}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("inbox.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadNotifications}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {notifications.map((notification) => (
        <View key={notification.id} style={[styles.card, notification.read_at ? styles.readCard : styles.unreadCard]}>
          <Text style={styles.cardTitle}>{notification.title}</Text>
          <Text style={styles.muted}>{notification.body}</Text>
          <Text style={styles.muted}>
            {t(`inbox.type.${notification.type}`)} ·{" "}
            {notification.read_at ? t("inbox.read") : t("inbox.unread")}
          </Text>
          <Text style={styles.muted}>{new Date(notification.created_at).toLocaleString()}</Text>
          {renderNotificationLink(notification)}
          {renderEventQuickSignup(notification)}
          {notification.read_at ? null : (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={() => handleMarkRead(notification.id)}
              style={[styles.secondaryButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("inbox.markRead")}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
    paddingTop: 72
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 10
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center"
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    gap: 8,
    padding: 16
  },
  unreadCard: {
    borderColor: colors.accent,
    borderWidth: 1
  },
  readCard: {
    opacity: 0.82
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  textArea: {
    minHeight: 96,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  activeButton: {
    backgroundColor: colors.accent
  },
  teamButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  countBadge: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  quickSignup: {
    gap: 8,
    marginTop: 4
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.7
  }
});
