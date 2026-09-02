import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  completeEvent,
  deleteEvent,
  getEvent,
  getMySignup,
  updateEvent,
  updateMySignup,
  type EventSignup,
  type MatchDetails,
  type SignupStatus,
  type TeamEvent
} from "@/features/events/api";
import {
  isSignupOpen,
  isValidMatchScoreResult,
  isValidEventSchedule,
  parseIsoDateTime,
  parseOptionalNonNegativeInteger
} from "@/features/events/validation";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

type SelectableSignupStatus = Extract<SignupStatus, "going" | "not_going">;

function selectableStatusFromSignup(signup: EventSignup): SelectableSignupStatus | null {
  if (signup.status === "going" || signup.status === "not_going") {
    return signup.status;
  }
  return null;
}

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const [event, setEvent] = useState<TeamEvent | null>(null);
  const [signup, setSignup] = useState<EventSignup | null>(null);
  const [selectedSignupStatus, setSelectedSignupStatus] = useState<SelectableSignupStatus | null>(null);
  const [leaveReason, setLeaveReason] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editOpponent, setEditOpponent] = useState("");
  const [editTeamScore, setEditTeamScore] = useState("");
  const [editOpponentScore, setEditOpponentScore] = useState("");
  const [editMatchResult, setEditMatchResult] = useState<MatchDetails["result"]>(null);
  const [editMatchNotes, setEditMatchNotes] = useState("");
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [isLoading, setIsLoading] = useState(false);

  function showError(nextMessage: string) {
    setMessageTone("error");
    setMessage(nextMessage);
  }

  function showSuccess(nextMessage: string) {
    setMessageTone("success");
    setMessage(nextMessage);
  }

  function clearMessage() {
    setMessageTone("error");
    setMessage(null);
  }

  function applyLoadedEvent(loadedEvent: TeamEvent, loadedSignup: EventSignup) {
    setEvent(loadedEvent);
    setSignup(loadedSignup);
    setSelectedSignupStatus(selectableStatusFromSignup(loadedSignup));
    setLeaveReason(loadedSignup.note ?? "");
    setEditTitle(loadedEvent.title);
    setEditDescription(loadedEvent.description ?? "");
    setEditLocation(loadedEvent.location ?? "");
    setEditStartTime(loadedEvent.start_time);
    setEditEndTime(loadedEvent.end_time);
    setEditOpponent(loadedEvent.match_details?.opponent ?? "");
    setEditTeamScore(loadedEvent.match_details?.team_score?.toString() ?? "");
    setEditOpponentScore(loadedEvent.match_details?.opponent_score?.toString() ?? "");
    setEditMatchResult(loadedEvent.match_details?.result ?? null);
    setEditMatchNotes(loadedEvent.match_details?.notes ?? "");
  }

  async function loadEventBundle() {
    if (!eventId) {
      return null;
    }
    const [loadedEvent, loadedSignup] = await Promise.all([getEvent(eventId), getMySignup(eventId)]);
    const teamHome = await getTeamHome(loadedEvent.team_id);
    return { loadedEvent, loadedSignup, currentRole: teamHome.current_membership.role };
  }

  async function handleLoadEvent() {
    if (!eventId) {
      return;
    }
    setIsLoading(true);
    clearMessage();
    try {
      const bundle = await loadEventBundle();
      if (bundle) {
        applyLoadedEvent(bundle.loadedEvent, bundle.loadedSignup);
        setCurrentRole(bundle.currentRole);
      }
    } catch (error) {
      showError(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshEventSilently() {
    if (!eventId) {
      return;
    }
    const bundle = await loadEventBundle();
    if (bundle) {
      applyLoadedEvent(bundle.loadedEvent, bundle.loadedSignup);
      setCurrentRole(bundle.currentRole);
    }
  }

  useEffect(() => {
    if (eventId) {
      void handleLoadEvent();
    }
  }, [eventId]);

  const canUpdateSignup = event?.status === "published" && isSignupOpen(event.start_time);
  const canManageEventStatus = event?.status === "published";
  const canManageEventRole = currentRole === "captain" || currentRole === "admin";
  const canManageEvent = canManageEventStatus && canManageEventRole;
  const canCompleteEvent = canManageEventRole && event?.status === "published";

  async function handleSubmitSignup() {
    if (!eventId) {
      return;
    }
    if (!canUpdateSignup) {
      showError(t("events.signupReadonly"));
      return;
    }
    if (selectedSignupStatus === null) {
      showError(t("events.signupSelectRequired"));
      return;
    }
    const normalizedNote = leaveReason.trim();
    if (selectedSignupStatus === "not_going" && normalizedNote.length === 0) {
      showError(t("events.signupNoteRequired"));
      return;
    }
    setIsLoading(true);
    clearMessage();
    try {
      const savedSignup = await updateMySignup(
        eventId,
        selectedSignupStatus,
        selectedSignupStatus === "not_going" ? normalizedNote : null
      );
      setSignup(savedSignup);
      setSelectedSignupStatus(selectableStatusFromSignup(savedSignup));
      setLeaveReason(savedSignup.note ?? "");
      await refreshEventSilently();
      showSuccess(t("events.signupSaved"));
    } catch (error) {
      showError(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageEventRole) {
      showError(t("events.captainOnlyHint"));
      return;
    }
    if (!canManageEventStatus) {
      showError(t("events.manageReadonly"));
      return;
    }
    const parsedStartTime = parseIsoDateTime(editStartTime);
    const parsedEndTime = parseIsoDateTime(editEndTime);
    const teamScore = parseOptionalNonNegativeInteger(editTeamScore);
    const opponentScore = parseOptionalNonNegativeInteger(editOpponentScore);
    if (
      editTitle.trim().length === 0 ||
      parsedStartTime === null ||
      parsedEndTime === null
    ) {
      showError(t("events.invalidEventInput"));
      return;
    }
    if (!isValidEventSchedule(parsedStartTime, parsedEndTime)) {
      showError(t("events.invalidSchedule"));
      return;
    }
    if (
      event?.type === "match" &&
      (editOpponent.trim().length === 0 ||
        (editTeamScore.trim().length > 0 && teamScore === null) ||
        (editOpponentScore.trim().length > 0 && opponentScore === null))
    ) {
      showError(t("events.invalidMatchInput"));
      return;
    }
    if (event?.type === "match" && !isValidMatchScoreResult(teamScore, opponentScore, editMatchResult)) {
      showError(t("events.invalidMatchScoreResult"));
      return;
    }
    setIsLoading(true);
    clearMessage();
    try {
      await updateEvent(eventId, {
        title: editTitle.trim(),
        description: editDescription.trim().length > 0 ? editDescription.trim() : null,
        location: editLocation.trim().length > 0 ? editLocation.trim() : null,
        start_time: parsedStartTime,
        end_time: parsedEndTime,
        ...(event?.type === "match"
          ? {
              match_details: {
                opponent: editOpponent.trim(),
                team_score: teamScore,
                opponent_score: opponentScore,
                result: editMatchResult,
                notes: editMatchNotes.trim().length > 0 ? editMatchNotes.trim() : null
              }
            }
          : {})
      });
      await refreshEventSilently();
      showSuccess(t("events.updated"));
    } catch (error) {
      showError(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function performDeleteEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageEventRole) {
      showError(t("events.captainOnlyHint"));
      return;
    }
    if (!canManageEventStatus) {
      showError(t("events.manageReadonly"));
      return;
    }
    setIsLoading(true);
    clearMessage();
    try {
      const deletedTeamId = event?.team_id ?? null;
      await deleteEvent(eventId);
      setEvent(null);
      setSignup(null);
      showSuccess(t("events.deleted"));
      if (deletedTeamId) {
        router.replace({ pathname: "/teams/[teamId]/events", params: { teamId: deletedTeamId } });
      }
    } catch (error) {
      showError(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function handleDeleteEvent() {
    if (!canManageEventRole) {
      showError(t("events.captainOnlyHint"));
      return;
    }
    if (!canManageEventStatus) {
      showError(t("events.manageReadonly"));
      return;
    }
    Alert.alert(t("events.deleteConfirmTitle"), t("events.deleteConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("events.deleteConfirmAction"), style: "destructive", onPress: () => void performDeleteEvent() }
    ]);
  }

  async function performCompleteEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageEventRole) {
      showError(t("events.captainOnlyHint"));
      return;
    }
    if (event?.status !== "published") {
      showError(t("events.manageReadonly"));
      return;
    }

    const teamScore = parseOptionalNonNegativeInteger(editTeamScore);
    const opponentScore = parseOptionalNonNegativeInteger(editOpponentScore);
    if (
      event.type === "match" &&
      ((editTeamScore.trim().length > 0 && teamScore === null) ||
        (editOpponentScore.trim().length > 0 && opponentScore === null) ||
        !isValidMatchScoreResult(teamScore, opponentScore, editMatchResult))
    ) {
      showError(t("events.invalidMatchScoreResult"));
      return;
    }

    setIsLoading(true);
    clearMessage();
    try {
      const completion = await completeEvent(
        eventId,
        event.type === "match"
          ? {
              match_details: {
                team_score: teamScore,
                opponent_score: opponentScore,
                result: editMatchResult,
                notes: editMatchNotes.trim().length > 0 ? editMatchNotes.trim() : null
              }
            }
          : {}
      );
      await refreshEventSilently();
      showSuccess(
        `${t("events.completed")} · ${t("events.goingCount")} ${completion.going_count} · ${t("events.rewardCount")} ${completion.reward_count}`
      );
    } catch (error) {
      showError(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function handleCompleteEvent() {
    if (!canManageEventRole) {
      showError(t("events.captainOnlyHint"));
      return;
    }
    if (event?.status !== "published") {
      showError(t("events.manageReadonly"));
      return;
    }
    Alert.alert(t("events.completeConfirmTitle"), t("events.completeConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("events.completeConfirmAction"), style: "destructive", onPress: () => void performCompleteEvent() }
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: event?.title ?? t("events.detail") }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{event?.title ?? t("events.detail")}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleLoadEvent}
          style={[styles.button, isLoading && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t("events.load")}</Text>
        </Pressable>
        <ScreenState
          isLoading={isLoading}
          authRequiredLabel={t("common.authRequired")}
          loadingLabel={t("common.loading")}
          message={message}
          messageTone={messageTone}
          onRetry={handleLoadEvent}
          retryLabel={t("common.retry")}
          signInLabel={t("home.openLogin")}
        />
        {event ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{event.title}</Text>
            <Text style={styles.muted}>
              {t(`events.${event.type}`)} · {t(`events.status.${event.status}`)}
            </Text>
            <Text style={styles.muted}>{event.location ?? ""}</Text>
            <Text style={styles.muted}>{new Date(event.start_time).toLocaleString()}</Text>
            {event.match_details ? <Text style={styles.muted}>{event.match_details.opponent}</Text> : null}
          </View>
        ) : null}

        {event && canManageEventRole && !canManageEventStatus ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("events.manage")}</Text>
            <Text style={styles.muted}>{t("events.manageReadonly")}</Text>
          </View>
        ) : null}

        {event && canManageEvent ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("events.manage")}</Text>
            <Text style={styles.muted}>{t("events.captainOnlyHint")}</Text>
            <TextInput
              onChangeText={setEditTitle}
              placeholder={t("events.titleField")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={editTitle}
            />
            <TextInput
              onChangeText={setEditLocation}
              placeholder={t("events.location")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={editLocation}
            />
            <TextInput
              multiline
              onChangeText={setEditDescription}
              placeholder={t("events.description")}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.multilineInput]}
              value={editDescription}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setEditStartTime}
              placeholder={t("events.startTime")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={editStartTime}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setEditEndTime}
              placeholder={t("events.endTime")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={editEndTime}
            />
            {event.type === "match" ? (
              <View style={styles.matchDetailsForm}>
                <Text style={styles.cardTitle}>{t("events.matchDetails")}</Text>
                <TextInput
                  onChangeText={setEditOpponent}
                  placeholder={t("events.opponent")}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={editOpponent}
                />
                <View style={styles.row}>
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={setEditTeamScore}
                    placeholder={t("events.teamScore")}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.rowInput]}
                    value={editTeamScore}
                  />
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={setEditOpponentScore}
                    placeholder={t("events.opponentScore")}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.rowInput]}
                    value={editOpponentScore}
                  />
                </View>
                <View style={styles.row}>
                  {(["win", "draw", "loss"] as const).map((result) => (
                    <Pressable
                      accessibilityRole="button"
                      disabled={isLoading}
                      key={result}
                      onPress={() => setEditMatchResult(editMatchResult === result ? null : result)}
                      style={[
                        styles.secondaryButton,
                        styles.rowInput,
                        editMatchResult === result && styles.activeButton,
                        isLoading && styles.disabled
                      ]}
                    >
                      <Text style={styles.secondaryText}>{t(`events.result.${result}`)}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  multiline
                  onChangeText={setEditMatchNotes}
                  placeholder={t("events.matchNotes")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multilineInput]}
                  value={editMatchNotes}
                />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={handleUpdateEvent}
              style={[styles.secondaryButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("events.update")}</Text>
            </Pressable>
            {canCompleteEvent ? (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={handleCompleteEvent}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
              >
                <Text style={styles.secondaryText}>{t("events.complete")}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={handleDeleteEvent}
              style={[styles.dangerButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("events.delete")}</Text>
            </Pressable>
          </View>
        ) : null}

        {event && !canManageEventRole ? (
          <View style={styles.actions}>
            {signup ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("events.mySignup")}</Text>
                <Text style={styles.muted}>{t(`events.signup.${signup.status}`)}</Text>
                {signup.note ? <Text style={styles.muted}>{signup.note}</Text> : null}
                {!canUpdateSignup ? <Text style={styles.muted}>{t("events.signupReadonly")}</Text> : null}
              </View>
            ) : null}
            {canUpdateSignup ? (
              <>
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isLoading}
                    onPress={() => setSelectedSignupStatus("going")}
                    style={[
                      styles.secondaryButton,
                      styles.rowInput,
                      selectedSignupStatus === "going" && styles.activeButton,
                      isLoading && styles.disabled
                    ]}
                  >
                    <Text style={styles.secondaryText}>{t("events.signupGoing")}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isLoading}
                    onPress={() => setSelectedSignupStatus("not_going")}
                    style={[
                      styles.secondaryButton,
                      styles.rowInput,
                      selectedSignupStatus === "not_going" && styles.activeButton,
                      isLoading && styles.disabled
                    ]}
                  >
                    <Text style={styles.secondaryText}>{t("events.signupLeave")}</Text>
                  </Pressable>
                </View>
                {selectedSignupStatus === "not_going" ? (
                  <TextInput
                    multiline
                    onChangeText={setLeaveReason}
                    placeholder={t("events.signupNote")}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, styles.multilineInput]}
                    value={leaveReason}
                  />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  onPress={handleSubmitSignup}
                  style={[styles.button, isLoading && styles.disabled]}
                >
                  <Text style={styles.buttonText}>{t("events.signupSubmit")}</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {event?.type === "match" && eventId ? (
          <Link href={{ pathname: "/events/[eventId]/live", params: { eventId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("match.liveBoard")}</Text>
            </Pressable>
          </Link>
        ) : null}
        {event?.type === "match" && eventId ? (
          <Link href={{ pathname: "/events/[eventId]/summary", params: { eventId } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("match.summary")}</Text>
            </Pressable>
          </Link>
        ) : null}
      </ScrollView>
    </>
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
    fontSize: 20,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  actions: {
    gap: 10
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
  matchDetailsForm: {
    gap: 10
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  rowInput: {
    flex: 1
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
  dangerButton: {
    alignItems: "center",
    backgroundColor: colors.dangerMuted,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center"
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
