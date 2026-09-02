import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { CompactLanguageToggle } from "@/components/LanguageToggle";
import { ScreenState } from "@/components/ScreenState";
import { Avatar, Badge, Button, Card, EmptyState, Screen } from "@/components/ui";
import { getMySignup, updateMySignup, type SignupStatus } from "@/features/events/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useTeamContext } from "@/providers/TeamProvider";
import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/tokens";

function formatEventWhen(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en", {
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export default function HomeScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { teams, home, selectedTeamId, isLoading, error, refresh, selectTeam } = useTeamContext();
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [signupMessage, setSignupMessage] = useState<string | null>(null);
  const [isSignupMessageSuccess, setIsSignupMessageSuccess] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [nextSignupStatus, setNextSignupStatus] = useState<SignupStatus | null>(null);

  const attendanceRate = useMemo(() => {
    if (!home || home.signup_summary.total === 0) {
      return "--";
    }
    return `${Math.round((home.signup_summary.going / home.signup_summary.total) * 100)}%`;
  }, [home]);

  const nextEvent = home?.upcoming_events[0] ?? null;
  const message = signupMessage ?? (error ? formatApiError(error, t) : null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadNextSignup() {
        if (!nextEvent?.id) {
          setNextSignupStatus(null);
          return;
        }
        try {
          const signup = await getMySignup(nextEvent.id);
          if (!cancelled) {
            setNextSignupStatus(signup.status);
          }
        } catch {
          if (!cancelled) {
            setNextSignupStatus(null);
          }
        }
      }

      void loadNextSignup();
      return () => {
        cancelled = true;
      };
    }, [nextEvent?.id, home])
  );

  async function handleQuickGoing() {
    if (!nextEvent) {
      return;
    }
    setIsSigningUp(true);
    setSignupMessage(null);
    try {
      await updateMySignup(nextEvent.id, "going", null);
      setNextSignupStatus("going");
      setIsSignupMessageSuccess(true);
      setSignupMessage(t("events.signupSaved"));
      await refresh();
    } catch (signupError) {
      setIsSignupMessageSuccess(false);
      setSignupMessage(formatApiError(signupError, t));
    } finally {
      setIsSigningUp(false);
    }
  }

  function openNextEventDetail() {
    if (!nextEvent) {
      return;
    }
    router.push({ pathname: "/events/[eventId]", params: { eventId: nextEvent.id } });
  }

  return (
    <Screen
      refreshing={isLoading}
      onRefresh={() => {
        setSignupMessage(null);
        setIsSignupMessageSuccess(false);
        void refresh();
      }}
    >
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={() => setShowTeamPicker(true)} style={styles.teamSwitcher}>
          <Text style={styles.teamLabel}>{t("home.currentTeam")}</Text>
          <View style={styles.teamNameRow}>
            <Text style={styles.teamName}>{home?.team.name ?? t("home.title")}</Text>
            <Ionicons color={colors.muted} name="chevron-down" size={16} />
          </View>
        </Pressable>
        <View style={styles.topActions}>
          <CompactLanguageToggle />
          <Link href="/profile" asChild>
            <Pressable accessibilityRole="button">
              <Avatar name={home?.current_membership.user?.name ?? "?"} size={40} />
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <Pressable
          accessibilityRole="button"
          disabled={!home?.team.id}
          onPress={() => {
            if (home?.team.id) {
              router.push({ pathname: "/teams/[teamId]/signup-board", params: { teamId: home.team.id } });
            }
          }}
          style={styles.metricCard}
        >
          <Card>
            <Text style={styles.metricLabel}>{t("home.attendance")}</Text>
            <Text style={[styles.metricValue, { color: colors.accentSoft }]}>{attendanceRate}</Text>
          </Card>
        </Pressable>
        <Card style={styles.metricCard}>
          <Text style={styles.metricLabel}>{t("home.coins")}</Text>
          <Text style={[styles.metricValue, { color: colors.gold }]}>
            {(home?.coin_summary.balance ?? "--").toLocaleString?.() ?? home?.coin_summary.balance ?? "--"}
          </Text>
        </Card>
      </View>

      <Text style={styles.sectionLabel}>{t("home.nextEvent")}</Text>
      {nextEvent ? (
        <Card accentBorder>
          <View style={styles.eventHeader}>
            <Badge
              label={nextEvent.type === "match" ? t("events.match") : t("events.training")}
              tone={nextEvent.type === "match" ? "purple" : "accent"}
            />
            <Text style={styles.eventWhen}>{formatEventWhen(nextEvent.start_time, locale)}</Text>
          </View>
          <Text style={styles.eventTitle}>{nextEvent.title}</Text>
          <Text style={styles.eventMeta}>
            <Ionicons color={colors.muted} name="location-outline" size={14} />{" "}
            {nextEvent.location ?? t("events.location")}
          </Text>
          <View style={styles.eventActions}>
            {nextSignupStatus === "going" ? (
              <Button
                label={t("home.confirmedGoing")}
                variant="secondary"
                onPress={openNextEventDetail}
                style={{ flex: 1 }}
              />
            ) : nextSignupStatus === "not_going" ? (
              <Button
                label={t("home.confirmedLeave")}
                variant="ghost"
                onPress={openNextEventDetail}
                style={{ flex: 1 }}
              />
            ) : (
              <Button
                label={t("home.confirmGoing")}
                disabled={isLoading || isSigningUp}
                onPress={() => void handleQuickGoing()}
                style={{ flex: 1 }}
              />
            )}
            <Button
              label={t("events.detail")}
              variant="secondary"
              onPress={openNextEventDetail}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : (
        <EmptyState title={t("home.noNextEvent")} description={t("home.noDashboard")} />
      )}

      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        messageTone={isSignupMessageSuccess && signupMessage ? "success" : "error"}
        onRetry={() => {
          setSignupMessage(null);
          setIsSignupMessageSuccess(false);
          void refresh();
        }}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      <Modal animationType="fade" transparent visible={showTeamPicker} onRequestClose={() => setShowTeamPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTeamPicker(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t("home.switchTeam")}</Text>
            {teams.map((team) => (
              <Pressable
                accessibilityRole="button"
                key={team.id}
                style={[styles.teamOption, selectedTeamId === team.id && styles.teamOptionActive]}
                onPress={() => {
                  setShowTeamPicker(false);
                  void selectTeam(team.id);
                }}
              >
                <Text style={styles.teamOptionText}>{team.name}</Text>
              </Pressable>
            ))}
            <Button
              label={t("home.openTeams")}
              variant="secondary"
              onPress={() => {
                setShowTeamPicker(false);
                router.push("/teams");
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  teamSwitcher: {
    flex: 1,
    gap: 2
  },
  teamLabel: {
    color: colors.muted,
    ...typography.caption
  },
  teamNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  teamName: {
    color: colors.text,
    ...typography.titleSm
  },
  topActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  metricsRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  metricCard: {
    flex: 1
  },
  metricLabel: {
    color: colors.muted,
    ...typography.caption
  },
  metricValue: {
    ...typography.metric
  },
  sectionLabel: {
    color: colors.muted,
    ...typography.section
  },
  eventHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  eventWhen: {
    color: colors.muted,
    ...typography.caption
  },
  eventTitle: {
    color: colors.text,
    ...typography.titleSm
  },
  eventMeta: {
    color: colors.muted,
    ...typography.caption
  },
  eventActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  modalOverlay: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.xl
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    gap: spacing.sm,
    padding: spacing.xl
  },
  modalTitle: {
    color: colors.text,
    marginBottom: spacing.sm,
    ...typography.section
  },
  teamOption: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md
  },
  teamOptionActive: {
    borderColor: colors.accent,
    borderWidth: 1
  },
  teamOptionText: {
    color: colors.text,
    ...typography.bodyStrong
  }
});
