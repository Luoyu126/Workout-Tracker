import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { parseOptionalIsoDateTime } from "@/features/events/validation";
import { getTeamSignupBoard, type SignupBoardRow } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function TeamSignupBoardScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [rows, setRows] = useState<SignupBoardRow[]>([]);
  const [startsAfter, setStartsAfter] = useState("");
  const [startsBefore, setStartsBefore] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLoadBoard() {
    if (!teamId) {
      return;
    }
    const parsedStartsAfter = parseOptionalIsoDateTime(startsAfter);
    const parsedStartsBefore = parseOptionalIsoDateTime(startsBefore);
    if (
      (startsAfter.trim().length > 0 && parsedStartsAfter === null) ||
      (startsBefore.trim().length > 0 && parsedStartsBefore === null)
    ) {
      setMessage(t("signupBoard.invalidDateTime"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const nextRows = await getTeamSignupBoard(teamId, {
        startsAfter: parsedStartsAfter,
        startsBefore: parsedStartsBefore
      });
      setRows(nextRows);
      if (nextRows.length === 0) {
        setMessage(t("signupBoard.noRows"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadBoard();
    }
  }, [teamId]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("signupBoard.title")}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("signupBoard.filters")}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setStartsAfter}
          placeholder={t("signupBoard.startsAfter")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={startsAfter}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setStartsBefore}
          placeholder={t("signupBoard.startsBefore")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={startsBefore}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadBoard}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("signupBoard.load")}</Text>
      </Pressable>
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
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  rate: {
    color: colors.accent,
    fontSize: 32,
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
