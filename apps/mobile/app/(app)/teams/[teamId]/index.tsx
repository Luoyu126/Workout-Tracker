import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { getTeamHome, updateTeam, type TeamHome } from "@/features/teams/api";
import { normalizeOptionalTeamText, normalizeTeamName } from "@/features/teams/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function TeamHomeScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [home, setHome] = useState<TeamHome | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamLogoUrl, setTeamLogoUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageTeam =
    home?.current_membership.role === "captain" || home?.current_membership.role === "admin";
  const canUpdateTeamStatus = home?.current_membership.role === "admin";

  async function handleLoadHome() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const loadedHome = await getTeamHome(teamId);
      setHome(loadedHome);
      setTeamName(loadedHome.team.name);
      setTeamDescription(loadedHome.team.description ?? "");
      setTeamLogoUrl(loadedHome.team.logo_url ?? "");
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadHome();
    }
  }, [teamId]);

  async function handleUpdateTeam(statusOverride?: TeamHome["team"]["status"]) {
    if (!teamId) {
      return;
    }
    if (!canManageTeam) {
      setMessage(t("teamHome.captainOnlyHint"));
      return;
    }
    if (statusOverride && !canUpdateTeamStatus) {
      setMessage(t("teamHome.adminOnlyHint"));
      return;
    }
    const normalizedTeamName = normalizeTeamName(teamName);
    if (normalizedTeamName === null) {
      setMessage(t("teamHome.invalidName"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const updatedTeam = await updateTeam(teamId, {
        name: normalizedTeamName,
        description: normalizeOptionalTeamText(teamDescription),
        logo_url: normalizeOptionalTeamText(teamLogoUrl),
        ...(statusOverride ? { status: statusOverride } : {})
      });
      setHome((currentHome) => (currentHome ? { ...currentHome, team: updatedTeam } : currentHome));
      setTeamName(updatedTeam.name);
      setTeamDescription(updatedTeam.description ?? "");
      setTeamLogoUrl(updatedTeam.logo_url ?? "");
      setMessage(t("teamHome.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function handleUpdateTeamStatus(nextStatus: TeamHome["team"]["status"]) {
    if (!canUpdateTeamStatus) {
      setMessage(t("teamHome.adminOnlyHint"));
      return;
    }
    const isArchiving = nextStatus === "archived";
    Alert.alert(
      isArchiving ? t("teamHome.archiveConfirmTitle") : t("teamHome.activateConfirmTitle"),
      isArchiving ? t("teamHome.archiveConfirmBody") : t("teamHome.activateConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: isArchiving ? t("teamHome.archiveTeam") : t("teamHome.activateTeam"),
          style: isArchiving ? "destructive" : "default",
          onPress: () => void handleUpdateTeam(nextStatus)
        }
      ]
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("teamHome.title")}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadHome}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("teamHome.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadHome}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {home ? (
        <>
          <View style={styles.heroCard}>
            {home.team.logo_url ? <Image source={{ uri: home.team.logo_url }} style={styles.teamLogo} /> : null}
            <Text style={styles.eyebrow}>{home.team.status}</Text>
            <Text style={styles.heroTitle}>{home.team.name}</Text>
            <Text style={styles.muted}>{home.team.description ?? t("teamHome.noDescription")}</Text>
          </View>
          {!canManageTeam ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t("teamHome.manageTeam")}</Text>
              <Text style={styles.muted}>{t("teamHome.captainOnlyHint")}</Text>
            </View>
          ) : null}
          {canManageTeam ? (
            <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("teamHome.manageTeam")}</Text>
            <TextInput
              onChangeText={setTeamName}
              placeholder={t("teamHome.name")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={teamName}
            />
            <TextInput
              multiline
              onChangeText={setTeamDescription}
              placeholder={t("teamHome.description")}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.multilineInput]}
              value={teamDescription}
            />
            <TextInput
              autoCapitalize="none"
              onChangeText={setTeamLogoUrl}
              placeholder={t("teamHome.logoUrl")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={teamLogoUrl}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={() => handleUpdateTeam()}
              style={[styles.secondaryButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("teamHome.saveTeam")}</Text>
            </Pressable>
            {canUpdateTeamStatus ? (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={() => handleUpdateTeamStatus(home.team.status === "active" ? "archived" : "active")}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
              >
                <Text style={styles.secondaryText}>
                  {home.team.status === "active" ? t("teamHome.archiveTeam") : t("teamHome.activateTeam")}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.muted}>{t("teamHome.adminOnlyHint")}</Text>
            )}
          </View>
          ) : null}
          <View style={styles.grid}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{home.member_count}</Text>
              <Text style={styles.muted}>{t("teamHome.members")}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{home.coin_summary.balance}</Text>
              <Text style={styles.muted}>{t("teamHome.myCoins")}</Text>
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("teamHome.attendanceSummary")}</Text>
            <Text style={styles.muted}>
              {t("signupBoard.going")} {home.signup_summary.going} · {t("signupBoard.maybe")}{" "}
              {home.signup_summary.maybe} · {t("signupBoard.notGoing")}{" "}
              {home.signup_summary.not_going}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("teamHome.admins")}</Text>
            {home.admins.length === 0 ? (
              <Text style={styles.muted}>{t("teamHome.noAdmins")}</Text>
            ) : (
              home.admins.map((admin) => (
                <Text key={admin.id} style={styles.muted}>
                  {admin.user?.name ?? admin.user_id}
                </Text>
              ))
            )}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("teamHome.upcomingEvents")}</Text>
            {home.upcoming_events.length === 0 ? (
              <Text style={styles.muted}>{t("events.noEvents")}</Text>
            ) : (
              home.upcoming_events.map((event) => (
                <View key={event.id} style={styles.eventRow}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <Text style={styles.muted}>
                    {t(`events.${event.type}`)} · {new Date(event.start_time).toLocaleString()}
                  </Text>
                  <Link href={{ pathname: "/events/[eventId]", params: { eventId: event.id } }} asChild>
                    <Pressable accessibilityRole="button" style={styles.secondaryButton}>
                      <Text style={styles.secondaryText}>{t("events.detail")}</Text>
                    </Pressable>
                  </Link>
                </View>
              ))
            )}
          </View>
          <View style={styles.actions}>
            <Link href={{ pathname: "/teams/[teamId]/members", params: { teamId } }} asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{t("teams.members")}</Text>
              </Pressable>
            </Link>
            <Link href={{ pathname: "/teams/[teamId]/events", params: { teamId } }} asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{t("teams.events")}</Text>
              </Pressable>
            </Link>
          </View>
          <Link href={{ pathname: "/teams/[teamId]/signup-board", params: { teamId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("signupBoard.title")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/inbox", params: { teamId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.inbox")}</Text>
            </Pressable>
          </Link>
          <View style={styles.actions}>
            <Link href={{ pathname: "/teams/[teamId]/store", params: { teamId } }} asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{t("teams.store")}</Text>
              </Pressable>
            </Link>
            <Link href={{ pathname: "/teams/[teamId]/coins", params: { teamId } }} asChild>
              <Pressable accessibilityRole="button" style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{t("teams.coins")}</Text>
              </Pressable>
            </Link>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
    paddingTop: 16
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
    borderRadius: 12,
    minHeight: 52,
    justifyContent: "center"
  },
  buttonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: "800"
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    gap: 8,
    padding: 20
  },
  teamLogo: {
    backgroundColor: colors.background,
    borderRadius: 12,
    height: 96,
    width: 96
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700"
  },
  heroTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900"
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    gap: 8,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  grid: {
    flexDirection: "row",
    gap: 12
  },
  metric: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    flex: 1,
    gap: 6,
    padding: 16
  },
  metricValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900"
  },
  eventRow: {
    backgroundColor: colors.background,
    borderRadius: 12,
    gap: 6,
    padding: 12
  },
  eventTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  multilineInput: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  actions: {
    flexDirection: "row",
    gap: 10
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  disabled: {
    opacity: 0.7
  }
});
