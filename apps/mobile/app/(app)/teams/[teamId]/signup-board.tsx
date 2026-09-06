import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { getTeamSignupBoard, type SignupBoardRow } from "@/features/teams/api";
import {
  signupBoardDateRange,
  toggleSignupBoardEventType,
  type SignupBoardEventType,
  type SignupBoardPeriod
} from "@/features/teams/signupBoardFilters";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function TeamSignupBoardScreen() {
  const [message, setMessage] = useState<string | null>(null);
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [rows, setRows] = useState<SignupBoardRow[]>([]);
  const [period, setPeriod] = useState<SignupBoardPeriod>("all");
  const [eventTypes, setEventTypes] = useState<SignupBoardEventType[]>(["training", "match"]);
  const requestVersion = useRef(0);
  const [isLoading, setIsLoading] = useState(true);

  const handleLoadBoard = useCallback(async () => {
    if (!teamId) {
      return;
    }
    const version = ++requestVersion.current;
    setIsLoading(true);
    setRows([]);
    setMessage(null);
    try {
      const nextRows = await getTeamSignupBoard(teamId, {
        ...signupBoardDateRange(period),
        eventTypes
      });
      if (version !== requestVersion.current) return;
      setRows(nextRows);
      if (nextRows.length === 0) {
        setMessage(t("signupBoard.noRows"));
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      setMessage(formatApiError(error, t));
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  }, [teamId, period, eventTypes, t]);

  useEffect(() => {
    if (teamId) {
      void handleLoadBoard();
    }
    return () => { requestVersion.current += 1; };
  }, [teamId, handleLoadBoard]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("signupBoard.title")}</Text>
      <View style={styles.card}>
        <View style={styles.filterRow}>
          {(["week", "month", "all"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: period === value }}
              onPress={() => setPeriod(value)}
              style={[styles.filterButton, period === value && styles.selectedButton]}
            >
              <Text style={[styles.filterText, period === value && styles.selectedText]}>
                {t(`signupBoard.${value}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.filterRow}>
          <Text style={styles.muted}>{t("signupBoard.type")}</Text>
          {(["training", "match"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: eventTypes.includes(value) }}
              onPress={() => setEventTypes((selected) => toggleSignupBoardEventType(selected, value))}
              style={[styles.filterButton, eventTypes.includes(value) && styles.selectedButton]}
            >
              <Text style={[styles.filterText, eventTypes.includes(value) && styles.selectedText]}>
                {t(`signupBoard.${value}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadBoard}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {rows.map((row) => (
        <View key={row.user_id} style={styles.card}>
          <Text style={styles.cardTitle}>{row.user?.name ?? row.user?.email ?? row.user_id}</Text>
          {row.user ? <Text style={styles.muted}>{row.user.email}</Text> : null}
          <Text style={styles.rate}>{Math.round(row.going_rate * 100)}%</Text>
          <Text style={styles.muted}>
            {t("signupBoard.going")} {row.going} · {t("signupBoard.maybe")} {row.maybe} ·{" "}
            {t("signupBoard.notGoing")} {row.not_going}
          </Text>
          <Text style={styles.muted}>
            {t("signupBoard.total")} {row.total}
          </Text>
        </View>
      ))}
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
  filterRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    flex: 1,
    minHeight: 44,
    justifyContent: "center"
  },
  selectedButton: {
    backgroundColor: colors.accent
  },
  filterText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  selectedText: {
    color: colors.accentText
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    gap: 8,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  rate: {
    color: colors.accent,
    fontSize: 32,
    fontWeight: "900"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  }
});
