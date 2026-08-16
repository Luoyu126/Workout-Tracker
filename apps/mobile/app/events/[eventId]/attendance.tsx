import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  completeEvent,
  getEventAttendance,
  upsertAttendance,
  type Attendance,
  type EventCompletionInput,
  type AttendanceStatus
} from "@/features/attendance/api";
import { normalizeAttendanceNote, normalizeUserId } from "@/features/attendance/validation";
import {
  getEvent,
  getEventSignups,
  type EventSignup,
  type MatchDetails,
  type SignupStatus,
  type TeamEvent
} from "@/features/events/api";
import { isValidMatchScoreResult, parseOptionalNonNegativeInteger } from "@/features/events/validation";
import { getTeamHome, getTeamMembers, type Membership, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

const signupStatuses: Array<SignupStatus | null> = [null, "going", "maybe", "not_going"];

export default function EventAttendanceScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { t } = useI18n();
  const [event, setEvent] = useState<TeamEvent | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [signups, setSignups] = useState<EventSignup[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [signupStatus, setSignupStatus] = useState<SignupStatus | null>(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [note, setNote] = useState("");
  const [finalTeamScore, setFinalTeamScore] = useState("");
  const [finalOpponentScore, setFinalOpponentScore] = useState("");
  const [finalMatchResult, setFinalMatchResult] = useState<MatchDetails["result"]>(null);
  const [finalMatchNotes, setFinalMatchNotes] = useState("");
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageAttendance = currentRole === "captain" || currentRole === "admin";

  function applyLoadedEvent(loadedEvent: TeamEvent) {
    setEvent(loadedEvent);
    setFinalTeamScore(loadedEvent.match_details?.team_score?.toString() ?? "");
    setFinalOpponentScore(loadedEvent.match_details?.opponent_score?.toString() ?? "");
    setFinalMatchResult(loadedEvent.match_details?.result ?? null);
    setFinalMatchNotes(loadedEvent.match_details?.notes ?? "");
  }

  async function refreshAttendanceData() {
    if (!eventId) {
      return;
    }
    const loadedEvent = await getEvent(eventId);
    const [teamHome, nextAttendance] = await Promise.all([
      getTeamHome(loadedEvent.team_id),
      getEventAttendance(eventId)
    ]);
    const nextRole = teamHome.current_membership.role;
    const nextCanManageAttendance = nextRole === "captain" || nextRole === "admin";
    const [nextSignups, nextMembers] = nextCanManageAttendance
      ? await Promise.all([
          getEventSignups(eventId, signupStatus),
          getTeamMembers(loadedEvent.team_id, { status: "active" })
        ])
      : [[], []];
    applyLoadedEvent(loadedEvent);
    setCurrentRole(nextRole);
    setAttendance(nextAttendance);
    setSignups(nextSignups);
    setMembers(nextMembers);
  }

  async function handleLoadAttendance() {
    if (!eventId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await refreshAttendanceData();
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (eventId) {
      void handleLoadAttendance();
    }
  }, [eventId, signupStatus]);

  async function performCompleteEvent(matchDetailsInput: EventCompletionInput) {
    if (!eventId) {
      return;
    }
    if (!canManageAttendance) {
      setMessage(t("attendance.captainOnlyHint"));
      return;
    }
    if (event?.status !== "published") {
      setMessage(t("attendance.recordReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const result = await completeEvent(eventId, matchDetailsInput);
      setMessage(
        `${t("attendance.completed")} · ${t("attendance.count")} ${result.attendance_count} · ${t(
          "attendance.rewardCount"
        )} ${result.reward_count}`
      );
      await refreshAttendanceData();
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function handleCompleteEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageAttendance) {
      setMessage(t("attendance.captainOnlyHint"));
      return;
    }
    if (event?.status !== "published") {
      setMessage(t("attendance.recordReadonly"));
      return;
    }
    const parsedTeamScore = parseOptionalNonNegativeInteger(finalTeamScore);
    const parsedOpponentScore = parseOptionalNonNegativeInteger(finalOpponentScore);
    if (
      event?.type === "match" &&
      ((finalTeamScore.trim().length > 0 && parsedTeamScore === null) ||
        (finalOpponentScore.trim().length > 0 && parsedOpponentScore === null))
    ) {
      setMessage(t("events.invalidMatchInput"));
      return;
    }
    if (event?.type === "match" && !isValidMatchScoreResult(parsedTeamScore, parsedOpponentScore, finalMatchResult)) {
      setMessage(t("events.invalidMatchScoreResult"));
      return;
    }
    const matchDetailsInput: EventCompletionInput =
      event?.type === "match"
        ? {
            match_details: {
              team_score: parsedTeamScore,
              opponent_score: parsedOpponentScore,
              result: finalMatchResult,
              notes: finalMatchNotes.trim().length > 0 ? finalMatchNotes : null
            }
          }
        : {};
    Alert.alert(t("attendance.completeConfirmTitle"), t("attendance.completeConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("attendance.completeConfirmAction"),
        onPress: () => void performCompleteEvent(matchDetailsInput)
      }
    ]);
  }

  async function handleRecordAttendance(userId: string, status: AttendanceStatus) {
    if (!eventId) {
      return;
    }
    if (!canManageAttendance) {
      setMessage(t("attendance.captainOnlyHint"));
      return;
    }
    if (event?.status !== "published" && event?.status !== "completed") {
      setMessage(t("attendance.recordReadonly"));
      return;
    }
    const normalizedUserId = normalizeUserId(userId);
    if (normalizedUserId === null) {
      setMessage(t("attendance.invalidUserId"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const savedAttendance = await upsertAttendance(
        eventId,
        normalizedUserId,
        status,
        normalizeAttendanceNote(note)
      );
      setAttendance((currentAttendance) => [
        savedAttendance,
        ...currentAttendance.filter((row) => row.user_id !== normalizedUserId)
      ]);
      await refreshAttendanceData();
      setMessage(t("attendance.saved"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function attendanceFor(userId: string) {
    return attendance.find((row) => row.user_id === userId) ?? null;
  }

  function memberLabel(
    row:
      | Pick<Attendance, "user_id" | "user">
      | Pick<EventSignup, "user_id" | "user">
      | Pick<Membership, "user_id" | "user">
  ) {
    return row.user?.name ?? row.user?.email ?? row.user_id;
  }

  const canRecordAttendance =
    canManageAttendance && (event?.status === "published" || event?.status === "completed");
  const canCompleteEvent = canManageAttendance && event?.status === "published";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("attendance.title")}</Text>
      {event ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("attendance.record")}</Text>
          <Text style={styles.muted}>
            {event.title} · {t(`events.status.${event.status}`)}
          </Text>
          {!canManageAttendance ? <Text style={styles.muted}>{t("attendance.captainOnlyHint")}</Text> : null}
          {canRecordAttendance ? (
            <>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setTargetUserId}
                placeholder={t("attendance.userId")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={targetUserId}
              />
              <TextInput
                autoCorrect={false}
                onChangeText={setNote}
                placeholder={t("attendance.note")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={note}
              />
              <View style={styles.grid}>
                {(["present", "late", "absent", "excused"] as const).map((status) => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isLoading}
                    key={status}
                    onPress={() => handleRecordAttendance(targetUserId, status)}
                    style={[styles.smallButton, isLoading && styles.disabled]}
                  >
                    <Text style={styles.secondaryText}>{t(`attendance.${status}`)}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.muted}>{t("attendance.recordReadonly")}</Text>
          )}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadAttendance}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("attendance.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadAttendance}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {canCompleteEvent ? (
        <View style={styles.card}>
          {event?.type === "match" ? (
            <>
              <Text style={styles.cardTitle}>{t("events.matchDetails")}</Text>
              <View style={styles.grid}>
                <TextInput
                  autoCorrect={false}
                  keyboardType="number-pad"
                  onChangeText={setFinalTeamScore}
                  placeholder={t("events.teamScore")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.halfInput]}
                  value={finalTeamScore}
                />
                <TextInput
                  autoCorrect={false}
                  keyboardType="number-pad"
                  onChangeText={setFinalOpponentScore}
                  placeholder={t("events.opponentScore")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.halfInput]}
                  value={finalOpponentScore}
                />
              </View>
              <View style={styles.grid}>
                {(["win", "draw", "loss"] as const).map((result) => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isLoading}
                    key={result}
                    onPress={() => setFinalMatchResult(finalMatchResult === result ? null : result)}
                    style={[styles.smallButton, finalMatchResult === result && styles.activeButton, isLoading && styles.disabled]}
                  >
                    <Text style={styles.secondaryText}>{t(`events.result.${result}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                autoCorrect={false}
                multiline
                onChangeText={setFinalMatchNotes}
                placeholder={t("events.matchNotes")}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.multilineInput]}
                value={finalMatchNotes}
              />
            </>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={handleCompleteEvent}
            style={[styles.secondaryButton, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("attendance.complete")}</Text>
          </Pressable>
        </View>
      ) : null}
      {event ? (
        <View style={styles.grid}>
          <Link href={{ pathname: "/teams/[teamId]/coins", params: { teamId: event.team_id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.smallButton}>
              <Text style={styles.secondaryText}>{t("coins.title")}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: "/teams/[teamId]/attendance-board", params: { teamId: event.team_id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.smallButton}>
              <Text style={styles.secondaryText}>{t("attendanceBoard.title")}</Text>
            </Pressable>
          </Link>
          {event.type === "match" && eventId ? (
            <Link href={{ pathname: "/events/[eventId]/summary", params: { eventId } }} asChild>
              <Pressable accessibilityRole="button" style={styles.smallButton}>
                <Text style={styles.secondaryText}>{t("match.summary")}</Text>
              </Pressable>
            </Link>
          ) : null}
        </View>
      ) : null}
      {canManageAttendance ? (
        <>
          <Text style={styles.sectionTitle}>{t("attendance.activeMembers")}</Text>
          {members.length === 0 ? <Text style={styles.muted}>{t("attendance.noMembers")}</Text> : null}
          <View style={styles.grid}>
            {members.map((membership) => {
              const currentAttendance = attendanceFor(membership.user_id);
              return (
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  key={membership.user_id}
                  onPress={() => setTargetUserId(membership.user_id)}
                  style={[
                    styles.memberButton,
                    targetUserId === membership.user_id && styles.activeButton,
                    isLoading && styles.disabled
                  ]}
                >
                  <Text style={styles.secondaryText}>{memberLabel(membership)}</Text>
                  <Text style={styles.muted}>
                    {membership.jersey_number ? `#${membership.jersey_number} · ` : ""}
                    {currentAttendance ? t(`attendance.${currentAttendance.status}`) : membership.position ?? membership.user?.email}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.sectionTitle}>{t("attendance.signups")}</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("attendance.signupFilters")}</Text>
            <View style={styles.grid}>
              {signupStatuses.map((status) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  key={status ?? "all"}
                  onPress={() => setSignupStatus(status)}
                  style={[styles.smallButton, signupStatus === status && styles.activeButton, isLoading && styles.disabled]}
                >
                  <Text style={styles.secondaryText}>
                    {status === null ? t("attendance.allSignupStatuses") : t(`events.signup.${status}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {signups.length === 0 ? <Text style={styles.muted}>{t("attendance.noSignups")}</Text> : null}
          {signups.map((signup) => {
            const currentAttendance = attendanceFor(signup.user_id);
            return (
              <View key={signup.user_id} style={styles.card}>
                <Text style={styles.cardTitle}>{memberLabel(signup)}</Text>
                {signup.user ? <Text style={styles.muted}>{signup.user.email}</Text> : null}
                <Text style={styles.muted}>
                  {t(`events.signup.${signup.status}`)}
                  {currentAttendance ? ` · ${t(`attendance.${currentAttendance.status}`)}` : ""}
                </Text>
                {signup.note ? <Text style={styles.muted}>{signup.note}</Text> : null}
                {canRecordAttendance ? (
                  <View style={styles.grid}>
                    {(["present", "late", "absent", "excused"] as const).map((status) => (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isLoading}
                        key={status}
                        onPress={() => handleRecordAttendance(signup.user_id, status)}
                        style={[
                          styles.smallButton,
                          currentAttendance?.status === status && styles.activeButton,
                          isLoading && styles.disabled
                        ]}
                      >
                        <Text style={styles.secondaryText}>{t(`attendance.${status}`)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
      <Text style={styles.sectionTitle}>{t("attendance.records")}</Text>
      {attendance.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.cardTitle}>{memberLabel(row)}</Text>
          {row.user ? <Text style={styles.muted}>{row.user.email}</Text> : null}
          <Text style={styles.muted}>{t(`attendance.${row.status}`)}</Text>
          {row.note ? <Text style={styles.muted}>{row.note}</Text> : null}
          {canRecordAttendance ? (
            <View style={styles.grid}>
              {(["present", "late", "absent", "excused"] as const).map((status) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  key={status}
                  onPress={() => handleRecordAttendance(row.user_id, status)}
                  style={[styles.smallButton, row.status === status && styles.activeButton, isLoading && styles.disabled]}
                >
                  <Text style={styles.secondaryText}>{t(`attendance.${status}`)}</Text>
                </Pressable>
              ))}
            </View>
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
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center"
  },
  secondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  halfInput: {
    minWidth: "48%"
  },
  multilineInput: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 42,
    justifyContent: "center",
    minWidth: "48%",
    paddingHorizontal: 10
  },
  memberButton: {
    backgroundColor: colors.background,
    borderRadius: 8,
    gap: 3,
    justifyContent: "center",
    minHeight: 56,
    minWidth: "48%",
    padding: 12
  },
  activeButton: {
    backgroundColor: colors.accent
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    gap: 6,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 8
  },
  disabled: {
    opacity: 0.7
  },
  message: {
    color: colors.muted,
    fontSize: 14
  }
});
