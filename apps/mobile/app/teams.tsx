import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { getMyOrganizations, getMyTeams, type Organization, type Team, type TeamStatus } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function TeamsScreen() {
  const { t } = useI18n();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamStatusFilter, setTeamStatusFilter] = useState<TeamStatus | null>("active");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function loadTeams(status: TeamStatus | null) {
    const teamsRequest =
      status === null
        ? Promise.all([getMyTeams({ status: "active" }), getMyTeams({ status: "archived" })]).then(
            ([activeTeams, archivedTeams]) => [...activeTeams, ...archivedTeams]
          )
        : getMyTeams({ status });
    const [nextOrganizations, nextTeams] = await Promise.all([getMyOrganizations(), teamsRequest]);
    setOrganizations(nextOrganizations);
    setTeams(nextTeams);
    if (nextTeams.length === 0) {
      setMessage(t("teams.noTeams"));
    }
  }

  async function handleLoadTeams() {
    setIsLoading(true);
    setMessage(null);
    try {
      await loadTeams(teamStatusFilter);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void handleLoadTeams();
  }, []);

  async function handleSelectTeamStatus(status: TeamStatus | null) {
    setTeamStatusFilter(status);
    setIsLoading(true);
    setMessage(null);
    try {
      await loadTeams(status);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("teams.title")}</Text>
      <View style={styles.filterRow}>
        {([null, "active", "archived"] as const).map((status) => (
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            key={status ?? "all"}
            onPress={() => handleSelectTeamStatus(status)}
            style={[styles.pillButton, teamStatusFilter === status && styles.activePill, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>
              {status === null ? t("teams.allStatuses") : t(`teams.status.${status}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadTeams}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("teams.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadTeams}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("teams.organizations")}</Text>
        {organizations.length === 0 ? <Text style={styles.muted}>{t("teams.noOrganizations")}</Text> : null}
        {organizations.map((organization) => (
          <View key={organization.id} style={styles.organizationRow}>
            <Text style={styles.secondaryText}>{organization.name}</Text>
            <Text style={styles.muted}>{organization.slug}</Text>
            {organization.logo_url ? <Text style={styles.muted}>{organization.logo_url}</Text> : null}
          </View>
        ))}
      </View>
      {teams.map((team) => (
        <View key={team.id} style={styles.card}>
          <Text style={styles.cardTitle}>{team.name}</Text>
          <Text style={styles.muted}>{team.description ?? team.status}</Text>
          <Link href={{ pathname: "/teams/[teamId]", params: { teamId: team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.home")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/teams/[teamId]/members", params: { teamId: team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.members")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/teams/[teamId]/events", params: { teamId: team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.events")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/teams/[teamId]/attendance-board", params: { teamId: team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.attendanceBoard")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/teams/[teamId]/store", params: { teamId: team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.store")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/teams/[teamId]/coins", params: { teamId: team.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("teams.coins")}</Text>
            </Pressable>
          </Link>
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
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  organizationRow: {
    backgroundColor: colors.background,
    borderRadius: 8,
    gap: 3,
    padding: 12
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  pillButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 999,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  activePill: {
    borderColor: colors.accent,
    borderWidth: 1
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
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
