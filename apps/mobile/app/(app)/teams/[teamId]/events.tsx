import { DateTimeField } from "@/components/ui/DateTimeField";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  getTeamEvents,
  type EventStatus,
  type EventType,
  type TeamEvent
} from "@/features/events/api";
import { parseOptionalIsoDateTime } from "@/features/events/validation";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function TeamEventsScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [filterType, setFilterType] = useState<EventType | null>(null);
  const [filterStatus, setFilterStatus] = useState<EventStatus | null>("published");
  const [startsAfter, setStartsAfter] = useState("");
  const [startsBefore, setStartsBefore] = useState("");
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageEvents = currentRole === "admin";

  function buildEventsQuery(type: EventType | null, status: EventStatus | null) {
    const parsedStartsAfter = parseOptionalIsoDateTime(startsAfter);
    const parsedStartsBefore = parseOptionalIsoDateTime(startsBefore);
    if ((startsAfter.trim().length > 0 && parsedStartsAfter === null) || (startsBefore.trim().length > 0 && parsedStartsBefore === null)) {
      setMessage(t("events.invalidDateTime"));
      return null;
    }
    return {
      type,
      status,
      startsAfter: parsedStartsAfter,
      startsBefore: parsedStartsBefore
    };
  }

  async function loadEvents(type: EventType | null, status: EventStatus | null) {
    if (!teamId) {
      return false;
    }
    const query = buildEventsQuery(type, status);
    if (query === null) {
      return false;
    }
    const nextEvents = await getTeamEvents(teamId, query);
    setEvents(nextEvents);
    return true;
  }

  async function handleLoadEvents() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    setLoadState({ status: "loading" });
    try {
      const [teamHome, eventsLoaded] = await Promise.all([
        getTeamHome(teamId),
        loadEvents(filterType, filterStatus)
      ]);
      if (!eventsLoaded) {
        setLoadState({ status: "idle" });
        return;
      }
      setCurrentRole(teamHome.current_membership.role);
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    } finally {
      setIsLoading(false);
    }
  }

  const loadOnFocus = useRef(handleLoadEvents);
  loadOnFocus.current = handleLoadEvents;
  useFocusEffect(useCallback(() => {
    void loadOnFocus.current();
  }, [teamId]));

  async function handleSelectFilterType(type: EventType | null) {
    setFilterType(type);
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    setLoadState({ status: "loading" });
    try {
      if (!await loadEvents(type, filterStatus)) {
        setLoadState({ status: "idle" });
        return;
      }
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectFilterStatus(status: EventStatus | null) {
    setFilterStatus(status);
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    setLoadState({ status: "loading" });
    try {
      if (!await loadEvents(filterType, status)) {
        setLoadState({ status: "idle" });
        return;
      }
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("events.title")}</Text>
      {!canManageEvents ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("events.create")}</Text>
          <Text style={styles.muted}>{t("events.captainOnlyHint")}</Text>
        </View>
      ) : null}
      {canManageEvents ? (
        <Link href={{ pathname: "/teams/[teamId]/events/new", params: { teamId } }} asChild>
          <Pressable accessibilityRole="button" style={styles.button}>
            <Text style={styles.buttonText}>{t("events.create")}</Text>
          </Pressable>
        </Link>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadEvents}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("events.load")}</Text>
      </Pressable>
      <ScreenState
        loadState={loadState}
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        emptyMessage={events.length === 0 ? t("events.noEvents") : null}
        message={message}
        onRetry={handleLoadEvents}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("events.filters")}</Text>
        <View style={styles.actions}>
          {([null, "training", "match"] as const).map((type) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={type ?? "all"}
              onPress={() => handleSelectFilterType(type)}
              style={[styles.pillButton, filterType === type && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {type === null ? t("events.allTypes") : t(`events.${type}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.actions}>
          {([null, "published", "completed"] as const).map((status) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={status ?? "all"}
              onPress={() => handleSelectFilterStatus(status)}
              style={[styles.pillButton, filterStatus === status && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {status === null ? t("events.allStatuses") : t(`events.status.${status}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <DateTimeField label={t("events.startsAfter")} value={startsAfter} onChange={setStartsAfter} disabled={isLoading} />
        <DateTimeField label={t("events.startsBefore")} value={startsBefore} onChange={setStartsBefore} disabled={isLoading} />
      </View>
      {events.map((event) => (
        <View key={event.id} style={styles.card}>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <Text style={styles.muted}>
            {t(`events.${event.type}`)} · {t(`events.status.${event.status}`)}
          </Text>
          <Text style={styles.muted}>{new Date(event.start_time).toLocaleString()}</Text>
          <Link href={{ pathname: "/events/[eventId]", params: { eventId: event.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("events.detail")}</Text>
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
    flexDirection: "row",
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
  pillButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 999,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  activePill: {
    backgroundColor: colors.accent
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
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
