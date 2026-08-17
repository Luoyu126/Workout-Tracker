import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  createMatchLog,
  deleteMatchLog,
  getLiveBoard,
  type LiveBoard,
  type MatchEntryType
} from "@/features/events/matchApi";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import { parseMatchMinute } from "@/features/events/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { normalizeRequiredText } from "@/lib/validation/text";
import { colors } from "@/theme/colors";

const LIVE_BOARD_POLL_INTERVAL_MS = 5000;

export default function LiveBoardScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { t } = useI18n();
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [entryType, setEntryType] = useState<MatchEntryType>("goal");
  const [minute, setMinute] = useState("0");
  const [playerName, setPlayerName] = useState("");
  const [playerNumber, setPlayerNumber] = useState("");
  const [subOutName, setSubOutName] = useState("");
  const [subOutNumber, setSubOutNumber] = useState("");
  const [subInName, setSubInName] = useState("");
  const [subInNumber, setSubInNumber] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);

  async function refreshLiveBoard(options: { showLoading?: boolean } = {}) {
    if (!eventId) {
      return;
    }
    if (options.showLoading) {
      setIsLoading(true);
    }
    setMessage(null);
    try {
      setBoard(await getLiveBoard(eventId));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      if (options.showLoading) {
        setIsLoading(false);
      }
    }
  }

  async function handleLoadBoard() {
    if (!eventId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const nextBoard = await getLiveBoard(eventId);
      setBoard(nextBoard);
      const teamHome = await getTeamHome(nextBoard.event.team_id);
      setCurrentRole(teamHome.current_membership.role);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (eventId) {
      void handleLoadBoard();
      const pollTimer = setInterval(() => {
        void refreshLiveBoard();
      }, LIVE_BOARD_POLL_INTERVAL_MS);

      return () => {
        clearInterval(pollTimer);
      };
    }
    return undefined;
  }, [eventId]);

  async function handleCreateLog() {
    if (!eventId) {
      return;
    }
    if (!canManageMatchLogs) {
      setMessage(t("match.captainOnlyHint"));
      return;
    }
    if (!canEditMatchLogs) {
      setMessage(t("match.logsReadonly"));
      return;
    }
    const parsedMinute = parseMatchMinute(minute);
    if (parsedMinute === null) {
      setMessage(t("match.invalidMinute"));
      return;
    }
    const normalizedPlayerName = normalizeRequiredText(playerName);
    const normalizedPlayerNumber = normalizeRequiredText(playerNumber);
    const normalizedSubOutName = normalizeRequiredText(subOutName);
    const normalizedSubOutNumber = normalizeRequiredText(subOutNumber);
    const normalizedSubInName = normalizeRequiredText(subInName);
    const normalizedSubInNumber = normalizeRequiredText(subInNumber);
    if (
      (entryType === "substitution" &&
        (!normalizedSubOutName || !normalizedSubOutNumber || !normalizedSubInName || !normalizedSubInNumber)) ||
      (entryType !== "substitution" && (!normalizedPlayerName || !normalizedPlayerNumber))
    ) {
      setMessage(t("match.invalidLogInput"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await createMatchLog(eventId, {
        entry_type: entryType,
        minute: parsedMinute,
        player_name: entryType === "substitution" ? null : normalizedPlayerName,
        player_number: entryType === "substitution" ? null : normalizedPlayerNumber,
        sub_out_player_name: entryType === "substitution" ? normalizedSubOutName : null,
        sub_out_player_number: entryType === "substitution" ? normalizedSubOutNumber : null,
        sub_in_player_name: entryType === "substitution" ? normalizedSubInName : null,
        sub_in_player_number: entryType === "substitution" ? normalizedSubInNumber : null
      });
      setMessage(t("match.logSaved"));
      setBoard(await getLiveBoard(eventId));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function performDeleteLog(logId: string) {
    if (!eventId) {
      return;
    }
    if (!canManageMatchLogs) {
      setMessage(t("match.captainOnlyHint"));
      return;
    }
    if (!canEditMatchLogs) {
      setMessage(t("match.logsReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await deleteMatchLog(logId);
      setMessage(t("match.logDeleted"));
      setBoard(await getLiveBoard(eventId));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteLog(logId: string) {
    if (!canManageMatchLogs) {
      setMessage(t("match.captainOnlyHint"));
      return;
    }
    if (!canEditMatchLogs) {
      setMessage(t("match.logsReadonly"));
      return;
    }
    Alert.alert(t("match.deleteLogConfirmTitle"), t("match.deleteLogConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("match.deleteLog"), style: "destructive", onPress: () => void performDeleteLog(logId) }
    ]);
  }

  const canEditMatchLogs = board?.event.status === "published";
  const canManageMatchLogs = currentRole === "captain" || currentRole === "admin";
  const canCreateMatchLogs = canEditMatchLogs && canManageMatchLogs;
  const canDeleteMatchLogs = canEditMatchLogs && canManageMatchLogs;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("match.liveBoard")}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadBoard}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("match.load")}</Text>
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
      {eventId ? (
        <View style={styles.grid}>
          <Link href={{ pathname: "/events/[eventId]/summary", params: { eventId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.smallButton}>
              <Text style={styles.secondaryText}>{t("match.summary")}</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}
      {board ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("match.addLog")}</Text>
          {canCreateMatchLogs ? (
            <>
              <View style={styles.grid}>
                {(["goal", "yellow_card", "red_card", "substitution"] as const).map((type) => (
                  <Pressable
                    accessibilityRole="button"
                    key={type}
                    onPress={() => setEntryType(type)}
                    style={[styles.smallButton, entryType === type && styles.activeButton]}
                  >
                    <Text style={styles.secondaryText}>{t(`match.${type}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                keyboardType="number-pad"
                onChangeText={setMinute}
                placeholder={t("match.minute")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={minute}
              />
              {entryType === "substitution" ? (
                <>
                  <View style={styles.row}>
                    <TextInput
                      autoCorrect={false}
                      onChangeText={setSubOutName}
                      placeholder={t("match.subOutName")}
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.rowInput]}
                      value={subOutName}
                    />
                    <TextInput
                      autoCorrect={false}
                      keyboardType="number-pad"
                      onChangeText={setSubOutNumber}
                      placeholder={t("match.subOutNumber")}
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.rowInput]}
                      value={subOutNumber}
                    />
                  </View>
                  <View style={styles.row}>
                    <TextInput
                      autoCorrect={false}
                      onChangeText={setSubInName}
                      placeholder={t("match.subInName")}
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.rowInput]}
                      value={subInName}
                    />
                    <TextInput
                      autoCorrect={false}
                      keyboardType="number-pad"
                      onChangeText={setSubInNumber}
                      placeholder={t("match.subInNumber")}
                      placeholderTextColor={colors.muted}
                      style={[styles.input, styles.rowInput]}
                      value={subInNumber}
                    />
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  <TextInput
                    autoCorrect={false}
                    onChangeText={setPlayerName}
                    placeholder={t("match.playerName")}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.rowInput]}
                    value={playerName}
                  />
                  <TextInput
                    autoCorrect={false}
                    keyboardType="number-pad"
                    onChangeText={setPlayerNumber}
                    placeholder={t("match.playerNumber")}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.rowInput]}
                    value={playerNumber}
                  />
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={handleCreateLog}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
              >
                <Text style={styles.secondaryText}>{t("match.saveLog")}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.muted}>
              {canEditMatchLogs ? t("match.captainOnlyHint") : t("match.logsReadonly")}
            </Text>
          )}
        </View>
      ) : null}
      {board ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{board.event.title}</Text>
          <Text style={styles.muted}>{board.match_details?.opponent}</Text>
          <Text style={styles.muted}>
            {t("match.goal")} {board.counts.goal} · {t("match.yellow_card")} {board.counts.yellow_card} ·{" "}
            {t("match.red_card")} {board.counts.red_card} · {t("match.substitution")} {board.counts.substitution}
          </Text>
        </View>
      ) : null}
      {board?.logs.map((log) => (
        <View key={log.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {log.minute}' · {t(`match.${log.entry_type}`)}
          </Text>
          <Text style={styles.muted}>
            {log.entry_type === "substitution"
              ? `${log.sub_out_player_name} #${log.sub_out_player_number} → ${log.sub_in_player_name} #${log.sub_in_player_number}`
              : `${log.player_name} #${log.player_number}`}
          </Text>
          {canDeleteMatchLogs ? (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={() => handleDeleteLog(log.id)}
              style={[styles.dangerButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("match.deleteLog")}</Text>
            </Pressable>
          ) : null}
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
  actions: {
    gap: 10
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  rowInput: {
    flex: 1
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    minHeight: 42,
    justifyContent: "center",
    minWidth: "48%",
    paddingHorizontal: 10
  },
  activeButton: {
    backgroundColor: colors.accent
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center"
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: colors.dangerMuted,
    borderRadius: 12,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    gap: 6,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  disabled: {
    opacity: 0.7
  },
  message: {
    color: colors.muted,
    fontSize: 14
  }
});
