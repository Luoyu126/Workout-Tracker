import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Badge, Card, EmptyState, Screen, SegmentedControl } from "@/components/ui";
import {
  getTeamEvents,
  type EventStatus,
  type EventType,
  type TeamEvent
} from "@/features/events/api";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useTeamContext } from "@/providers/TeamProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

export default function EventsTabScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const { t } = useI18n();
  const router = useRouter();
  const { selectedTeamId, role, home, loadState: teamLoadState, refresh: refreshTeam } = useTeamContext();
  const canManageEvents = role === "admin";
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [filterType, setFilterType] = useState<EventType | null>(null);
  const [filterStatus, setFilterStatus] = useState<EventStatus | null>("published");
  const [isLoading, setIsLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!selectedTeamId) {
      setEvents([]);
      return;
    }
    setIsLoading(true);
    setLoadState({ status: "loading" });
    try {
      const nextEvents = await getTeamEvents(selectedTeamId, {
        type: filterType,
        status: filterStatus
      });
      setEvents(nextEvents);
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    } finally {
      setIsLoading(false);
    }
  }, [selectedTeamId, filterType, filterStatus, canManageEvents, t]);

  useFocusEffect(useCallback(() => {
    void loadEvents();
  }, [loadEvents]));


  return (
    <Screen
      title={t("events.title")}
      subtitle={home?.team.name}
      refreshing={isLoading}
      onRefresh={() => void loadEvents()}
      headerRight={
        canManageEvents && selectedTeamId ? (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/teams/[teamId]/events/new", params: { teamId: selectedTeamId } })} style={styles.createBtn}>
            <Ionicons color={colors.accentText} name="add" size={20} />
            <Text style={styles.createBtnText}>{t("events.create")}</Text>
          </Pressable>
        ) : null
      }
    >
      {!selectedTeamId && teamLoadState.status === "success" ? (
        <EmptyState
          title={t("teams.noTeams")}
          actionLabel={t("teams.requestToJoin")}
          onAction={() => router.push("/teams/join")}
        />
      ) : null}

      <SegmentedControl
        value={filterType}
        onChange={setFilterType}
        options={[
          { value: null, label: t("events.allTypes") },
          { value: "training", label: t("events.training") },
          { value: "match", label: t("events.match") }
        ]}
      />
      {canManageEvents ? (
        <SegmentedControl
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: null, label: t("events.allStatuses") },
            { value: "published", label: t("events.status.published") },
            { value: "completed", label: t("events.status.completed") }
          ]}
        />
      ) : null}

      <ScreenState
        loadState={teamLoadState.status === "success" ? loadState : teamLoadState}
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        emptyMessage={events.length === 0 ? t("events.noEvents") : null}
        onRetry={teamLoadState.status === "error" ? () => void refreshTeam() : () => void loadEvents()}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      {events.map((event) => (
        <Pressable
          accessibilityRole="button"
          key={event.id}
          onPress={() => router.push({ pathname: "/events/[eventId]", params: { eventId: event.id } })}
        >
          <Card>
            <View style={styles.rowBetween}>
              <Badge
                label={t(`events.${event.type}`)}
                tone={event.type === "match" ? "purple" : "accent"}
              />
              <Badge label={t(`events.status.${event.status}`)} tone="muted" />
            </View>
            <Text style={styles.cardTitle}>{event.title}</Text>
            <Text style={styles.muted}>{new Date(event.start_time).toLocaleString()}</Text>
            {event.location ? <Text style={styles.muted}>{event.location}</Text> : null}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  createBtn: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  createBtnText: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: "800"
  },
  cardTitle: {
    color: colors.text,
    ...typography.section
  },
  muted: {
    color: colors.muted,
    ...typography.caption
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between"
  }
});
