import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { LanguageToggle } from "@/components/LanguageToggle";
import { ScreenState } from "@/components/ScreenState";
import { getMyTeams, getTeamHome, type Team, type TeamHome } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function HomeScreen() {
  const { t } = useI18n();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [home, setHome] = useState<TeamHome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const attendanceRate = useMemo(() => {
    if (!home || home.attendance_summary.total === 0) {
      return "--";
    }
    const attended = home.attendance_summary.present + home.attendance_summary.late;
    return `${Math.round((attended / home.attendance_summary.total) * 100)}%`;
  }, [home]);

  const nextEvent = home?.upcoming_events[0] ?? null;

  async function handleLoadDashboard() {
    setIsLoading(true);
    setMessage(null);
    try {
      const nextTeams = await getMyTeams();
      setTeams(nextTeams);
      if (nextTeams.length === 0) {
        setHome(null);
        setSelectedTeamId(null);
        setMessage(t("teams.noTeams"));
        return;
      }
      const nextSelectedTeamId =
        selectedTeamId && nextTeams.some((team) => team.id === selectedTeamId)
          ? selectedTeamId
          : nextTeams[0].id;
      setSelectedTeamId(nextSelectedTeamId);
      setHome(await getTeamHome(nextSelectedTeamId));
    } catch (error) {
      setHome(null);
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectTeam(teamId: string) {
    setSelectedTeamId(teamId);
    setIsLoading(true);
    setMessage(null);
    try {
      setHome(await getTeamHome(teamId));
    } catch (error) {
      setHome(null);
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void handleLoadDashboard();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t("home.today")}</Text>
        <Text style={styles.title}>{t("home.title")}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("home.nextEvent")}</Text>
        {nextEvent ? (
          <>
            <Text style={styles.eventTitle}>{nextEvent.title}</Text>
            <Text style={styles.muted}>
              {new Date(nextEvent.start_time).toLocaleString()} ·{" "}
              {nextEvent.location ?? t("events.location")}
            </Text>
            <Link href={{ pathname: "/events/[eventId]", params: { eventId: nextEvent.id } }} asChild>
              <Pressable accessibilityRole="button" style={styles.inlineButton}>
                <Text style={styles.secondaryText}>{t("events.detail")}</Text>
              </Pressable>
            </Link>
          </>
        ) : (
          <Text style={styles.muted}>{t("home.noDashboard")}</Text>
        )}
      </View>

      <View style={styles.grid}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{attendanceRate}</Text>
          <Text style={styles.muted}>{t("home.attendance")}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{home?.coin_summary.balance ?? "--"}</Text>
          <Text style={styles.muted}>{t("home.coins")}</Text>
        </View>
      </View>

      {home ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{home.team.name}</Text>
          <Text style={styles.muted}>
            {t("teamHome.members")} {home.member_count} · {t("teamHome.captains")}{" "}
            {home.captains.length}
          </Text>
          <Link href={{ pathname: "/teams/[teamId]", params: { teamId: home.team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.inlineButton}>
              <Text style={styles.secondaryText}>{t("teams.home")}</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}

      {teams.length > 1 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("home.switchTeam")}</Text>
          <View style={styles.teamSwitcher}>
            {teams.map((team) => (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                key={team.id}
                onPress={() => handleSelectTeam(team.id)}
                style={[styles.teamPill, selectedTeamId === team.id && styles.activeTeamPill]}
              >
                <Text style={styles.secondaryText}>{team.name}</Text>
              </Pressable>
            ))}
          </View>
          {home ? (
            <Text style={styles.muted}>
              {t("home.currentTeam")} {home.team.name}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Link href="/login" asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("home.openLogin")}</Text>
          </Pressable>
        </Link>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("home.openProfile")}</Text>
          </Pressable>
        </Link>
      </View>
      <Link href="/teams" asChild>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>{t("home.openTeams")}</Text>
        </Pressable>
      </Link>
      <Link href="/inbox" asChild>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>{t("home.openInbox")}</Text>
        </Pressable>
      </Link>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadDashboard}
        style={[styles.secondaryButton, isLoading && styles.disabled]}
      >
        <Text style={styles.secondaryText}>{t("home.refresh")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadDashboard}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      <LanguageToggle />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 18,
    padding: 20,
    paddingTop: 72
  },
  header: {
    gap: 8
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 14
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "800"
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    gap: 8,
    padding: 18
  },
  cardTitle: {
    color: colors.muted,
    fontSize: 14
  },
  eventTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  grid: {
    flexDirection: "row",
    gap: 12
  },
  actions: {
    flexDirection: "row",
    gap: 12
  },
  teamSwitcher: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  teamPill: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  activeTeamPill: {
    backgroundColor: colors.accent
  },
  metric: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    flex: 1,
    gap: 6,
    padding: 16
  },
  metricValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  inlineButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 16
  },
  secondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.7
  }
});
