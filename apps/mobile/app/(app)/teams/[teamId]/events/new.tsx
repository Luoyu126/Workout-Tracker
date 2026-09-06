import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Button, Card, Screen, SegmentedControl, TextField } from "@/components/ui";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { createEvent, createMatch, type EventType } from "@/features/events/api";
import { isValidEventSchedule, parseIsoDateTime } from "@/features/events/validation";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useTransientFeedback } from "@/lib/ui/useTransientFeedback";
import { generateClientUuid } from "@/lib/uuid";
import { colors } from "@/theme/colors";

export default function CreateEventScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  return <CreateEventForm key={teamId} teamId={teamId} />;
}

export function CreateEventForm({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [teamName, setTeamName] = useState("");
  const [eventType, setEventType] = useState<EventType>("training");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [opponent, setOpponent] = useState("");
  const [matchNotes, setMatchNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useTransientFeedback(isLoading || loadState.status === "loading");
  const submittingRef = useRef(false);
  const pendingSubmission = useRef<{ payloadKey: string; id: string } | null>(null);
  const requestVersion = useRef(0);
  const canManageEvents = loadState.status === "success" && currentRole === "admin";
  const handleLoadTeam = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoadState({ status: "loading" });
    try {
      const home = await getTeamHome(teamId);
      if (version !== requestVersion.current) return;
      setCurrentRole(home.current_membership.role);
      setTeamName(home.team.name);
      setLoadState({ status: "success" });
    } catch (error) {
      if (version === requestVersion.current) setLoadState({ status: "error", error });
    }
  }, [teamId]);
  useEffect(() => {
    void handleLoadTeam();
    return () => { requestVersion.current += 1; };
  }, [handleLoadTeam]);

  async function handleCreateEvent() {
    if (submittingRef.current) return;
    if (!teamId || !canManageEvents) {
      setMessage(t("events.captainOnlyHint"));
      return;
    }
    const parsedStartTime = parseIsoDateTime(startTime);
    const parsedEndTime = parseIsoDateTime(endTime);
    if (
      title.trim().length === 0 ||
      parsedStartTime === null ||
      parsedEndTime === null
    ) {
      setMessage(t("events.invalidEventInput"));
      return;
    }
    if (!isValidEventSchedule(parsedStartTime, parsedEndTime)) {
      setMessage(t("events.invalidSchedule"));
      return;
    }
    if (eventType === "match" && opponent.trim().length === 0) {
      setMessage(t("events.invalidMatchInput"));
      return;
    }
    const version = requestVersion.current;
    submittingRef.current = true;
    setIsLoading(true);
    setMessage(null);
    try {
      const eventInput = {
        type: eventType,
        title: title.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
        location: location.trim().length > 0 ? location.trim() : null,
        start_time: parsedStartTime,
        end_time: parsedEndTime
      };
      const payloadKey = JSON.stringify({ teamId, eventInput, opponent, matchNotes });
      if (pendingSubmission.current?.payloadKey !== payloadKey) {
        pendingSubmission.current = { payloadKey, id: generateClientUuid() };
      }
      const input = { ...eventInput, id: pendingSubmission.current.id };
      const created =
        eventType === "match"
          ? await createMatch(teamId, {
              event: input,
              match_details: {
                opponent: opponent.trim(),
                notes: matchNotes.trim().length > 0 ? matchNotes.trim() : null
              }
            })
          : await createEvent(teamId, input);
      if (version !== requestVersion.current) return;
      router.replace({ pathname: "/events/[eventId]", params: { eventId: created.id } });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      submittingRef.current = false;
      setIsLoading(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t("events.create") }} />
      <Screen title={t("events.create")} subtitle={teamName}>
        <ScreenState loadState={loadState} isLoading={isLoading} message={message}
          loadingLabel={t("common.loading")} retryLabel={t("common.retry")} onRetry={handleLoadTeam} />
        {loadState.status === "success" && !canManageEvents ? <Text style={styles.muted}>{t("events.captainOnlyHint")}</Text> : null}
        {canManageEvents ? (
        <Card>
          <SegmentedControl
            disabled={isLoading}
            value={eventType}
            onChange={setEventType}
            options={[
              { value: "training", label: t("events.training") },
              { value: "match", label: t("events.match") }
            ]}
          />
          <TextField editable={!isLoading} label={t("events.titleField")} onChangeText={setTitle} value={title} />
          <TextField editable={!isLoading} label={t("events.location")} onChangeText={setLocation} value={location} />
          <TextField editable={!isLoading} label={t("events.description")} multiline onChangeText={setDescription} value={description} />
          <DateTimeField label={t("events.startTime")} value={startTime} onChange={setStartTime} disabled={isLoading} />
          <DateTimeField label={t("events.endTime")} value={endTime} onChange={setEndTime} disabled={isLoading} />
          {eventType === "match" ? (
            <>
              <TextField editable={!isLoading} autoCorrect={false} label={t("events.opponent")} onChangeText={setOpponent} value={opponent} />
              <TextField editable={!isLoading} label={t("events.matchNotes")} multiline onChangeText={setMatchNotes} value={matchNotes} />
            </>
          ) : null}
          <Button disabled={isLoading} label={t("events.create")} onPress={() => void handleCreateEvent()} />
        </Card>
        ) : null}
      </Screen>
    </>
  );
}
const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 }
});
