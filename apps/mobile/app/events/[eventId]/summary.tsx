import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { getMatchSummary, type MatchSummary } from "@/features/events/matchApi";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function MatchSummaryScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { t } = useI18n();
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLoadSummary() {
    if (!eventId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      setSummary(await getMatchSummary(eventId));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (eventId) {
      void handleLoadSummary();
    }
  }, [eventId]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("match.summary")}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadSummary}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("match.loadSummary")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadSummary}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {eventId ? (
        <View style={styles.grid}>
          <Link href={{ pathname: "/events/[eventId]", params: { eventId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.smallButton}>
              <Text style={styles.secondaryText}>{t("events.detail")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/events/[eventId]/attendance", params: { eventId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.smallButton}>
              <Text style={styles.secondaryText}>{t("attendance.title")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/events/[eventId]/live", params: { eventId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.smallButton}>
              <Text style={styles.secondaryText}>{t("match.liveBoard")}</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}
      {summary ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{summary.event.title}</Text>
            <Text style={styles.muted}>
              {summary.match_details?.opponent ?? t("match.noOpponent")}
            </Text>
            <Text style={styles.score}>
              {summary.match_details?.team_score ?? "-"} : {summary.match_details?.opponent_score ?? "-"}
            </Text>
            <Text style={styles.muted}>
              {t("match.result")}{" "}
              {summary.match_details?.result ? t(`events.result.${summary.match_details.result}`) : "-"}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("match.logStats")}</Text>
            <Text style={styles.muted}>
              {t("match.goal")} {summary.counts.goal ?? 0} · {t("match.yellow_card")}{" "}
              {summary.counts.yellow_card ?? 0} · {t("match.red_card")} {summary.counts.red_card ?? 0}
            </Text>
            <Text style={styles.muted}>
              {t("match.substitution")} {summary.counts.substitution ?? 0}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("match.attendanceSummary")}</Text>
            {summary.attendance.length > 0 ? (
              summary.attendance.map((row, index) => (
                <Text key={`${String(row.user_id)}-${index}`} style={styles.muted}>
                  {row.user_id} · {t(`attendance.${row.status}`)}
                </Text>
              ))
            ) : (
              <Text style={styles.muted}>{t("match.noAttendance")}</Text>
            )}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("match.rewardSummary")}</Text>
            {summary.rewards.length > 0 ? (
              summary.rewards.map((row, index) => (
                <Text key={`${String(row.user_id)}-${index}`} style={styles.muted}>
                  {row.user_id} · {row.amount}
                </Text>
              ))
            ) : (
              <Text style={styles.muted}>{t("match.noRewards")}</Text>
            )}
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
    borderRadius: 16,
    gap: 8,
    padding: 16
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    minWidth: "31%",
    paddingHorizontal: 10
  },
  secondaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  score: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  disabled: {
    opacity: 0.7
  }
});
