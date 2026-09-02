import { Stack } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Avatar, Button, Card, EmptyState, Screen, TextField } from "@/components/ui";
import {
  requestToJoinTeam,
  searchTeams,
  type TeamSearchResult
} from "@/features/teams/api";
import { normalizeTeamSearchQuery } from "@/features/teams/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

export default function JoinTeamScreen() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [lastSearchQuery, setLastSearchQuery] = useState<string | null>(null);
  const [results, setResults] = useState<TeamSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const applyingTeamIdsRef = useRef(new Set<string>());
  const [applyingTeamIds, setApplyingTeamIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [retrySearchQuery, setRetrySearchQuery] = useState<string | null>(null);

  async function handleSearch(queryOverride?: string) {
    const normalizedQuery = normalizeTeamSearchQuery(queryOverride ?? query);
    if (normalizedQuery === null) {
      setMessageTone("error");
      setMessage(t("teams.searchMinLength"));
      setRetrySearchQuery(null);
      return;
    }

    setQuery(normalizedQuery);
    setLastSearchQuery(normalizedQuery);
    setHasSearched(true);
    setIsSearching(true);
    setResults([]);
    setMessage(null);
    setRetrySearchQuery(null);
    try {
      setResults(await searchTeams(normalizedQuery));
    } catch (error) {
      setMessageTone("error");
      setMessage(formatApiError(error, t));
      setRetrySearchQuery(normalizedQuery);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleRequestToJoin(teamId: string) {
    if (applyingTeamIdsRef.current.has(teamId)) {
      return;
    }
    applyingTeamIdsRef.current.add(teamId);
    setApplyingTeamIds((currentIds) => new Set(currentIds).add(teamId));
    setMessage(null);
    setRetrySearchQuery(null);
    try {
      await requestToJoinTeam(teamId);
      setResults((currentResults) =>
        currentResults.map((result) =>
          result.id === teamId ? { ...result, membership_status: "pending" } : result
        )
      );
      setMessageTone("success");
      setMessage(t("teams.requestSubmitted"));
    } catch (error) {
      setMessageTone("error");
      setMessage(formatApiError(error, t));
    } finally {
      applyingTeamIdsRef.current.delete(teamId);
      setApplyingTeamIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(teamId);
        return nextIds;
      });
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t("teams.requestToJoin") }} />
      <Screen
        edges={["left", "right"]}
        title={t("teams.requestToJoin")}
        subtitle={t("teams.searchInstructions")}
      >
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <TextField
              autoCapitalize="none"
              autoCorrect={false}
              label={t("teams.searchLabel")}
              onChangeText={setQuery}
              onSubmitEditing={() => void handleSearch()}
              placeholder={t("teams.searchPlaceholder")}
              returnKeyType="search"
              value={query}
            />
          </View>
          <Button
            disabled={isSearching}
            label={t("teams.searchAction")}
            onPress={() => void handleSearch()}
            style={styles.searchButton}
          />
        </View>

        <ScreenState
          isLoading={isSearching}
          loadingLabel={t("common.loading")}
          message={message}
          messageTone={messageTone}
          onRetry={
            retrySearchQuery === null
              ? undefined
              : () => {
                  void handleSearch(retrySearchQuery);
                }
          }
          retryLabel={t("common.retry")}
        />

        {!hasSearched && !isSearching && !message ? (
          <EmptyState
            title={t("teams.searchPromptTitle")}
            description={t("teams.searchPromptDescription")}
          />
        ) : null}

        {hasSearched && !isSearching && !message && results.length === 0 ? (
          <EmptyState
            title={t("teams.noSearchResults")}
            description={t("teams.noSearchResultsHint")}
          />
        ) : null}

        {results.map((team) => {
          const isPending = team.membership_status === "pending";
          const isActive = team.membership_status === "active";
          const isApplying = applyingTeamIds.has(team.id);
          const actionLabel = isPending
            ? t("teams.requestPending")
            : isActive
              ? t("teams.alreadyJoined")
              : isApplying
                ? t("teams.requesting")
                : t("teams.applyToJoin");

          return (
            <Card key={team.id}>
              <View style={styles.teamHeader}>
                <Avatar name={team.name} size={48} uri={team.logo_url} />
                <View style={styles.teamHeading}>
                  <Text style={styles.teamName}>{team.name}</Text>
                  <Text style={styles.organizationName}>{team.organization_name}</Text>
                </View>
              </View>
              <Text style={styles.description}>{team.description ?? t("teams.noDescription")}</Text>
              <Button
                disabled={isPending || isActive || isApplying}
                label={actionLabel}
                onPress={() => void handleRequestToJoin(team.id)}
                variant={isPending || isActive ? "secondary" : "primary"}
              />
            </Card>
          );
        })}

        {lastSearchQuery && !isSearching && results.length > 0 ? (
          <Text style={styles.resultSummary}>
            {t("teams.searchResultsFor").replace("{query}", lastSearchQuery)}
          </Text>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.sm
  },
  searchField: {
    flex: 1
  },
  searchButton: {
    minWidth: 88
  },
  teamHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  teamHeading: {
    flex: 1,
    gap: 2
  },
  teamName: {
    color: colors.text,
    ...typography.titleSm
  },
  organizationName: {
    color: colors.accentSoft,
    ...typography.caption
  },
  description: {
    color: colors.muted,
    ...typography.body
  },
  resultSummary: {
    color: colors.subtle,
    textAlign: "center",
    ...typography.caption
  }
});
