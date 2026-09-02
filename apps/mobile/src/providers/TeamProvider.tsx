import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";

import { getMyTeams, getTeamHome, type MembershipRole, type Team, type TeamHome } from "@/features/teams/api";
import { useAuth } from "@/providers/AuthProvider";

const SELECTED_TEAM_KEY = "workout-tracker.selected-team-id";

type TeamContextValue = {
  teams: Team[];
  selectedTeamId: string | null;
  home: TeamHome | null;
  role: MembershipRole | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
  selectTeam: (teamId: string) => Promise<void>;
};

const TeamContext = createContext<TeamContextValue | null>(null);

async function readSelectedTeamId() {
  try {
    return await SecureStore.getItemAsync(SELECTED_TEAM_KEY);
  } catch {
    return null;
  }
}

async function writeSelectedTeamId(teamId: string | null) {
  try {
    if (teamId) {
      await SecureStore.setItemAsync(SELECTED_TEAM_KEY, teamId);
    } else {
      await SecureStore.deleteItemAsync(SELECTED_TEAM_KEY);
    }
  } catch {
    // Persistence is best-effort.
  }
}

export function TeamProvider({ children }: PropsWithChildren) {
  const { status: authStatus } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [home, setHome] = useState<TeamHome | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestVersionRef = useRef(0);

  const reset = useCallback(() => {
    setTeams([]);
    setSelectedTeamId(null);
    setHome(null);
    setIsLoading(false);
    setError(null);
  }, []);

  const load = useCallback(async (preferredTeamId?: string | null) => {
    if (authStatus !== "ready") {
      return;
    }
    const requestVersion = ++requestVersionRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const nextTeams = await getMyTeams({ status: "active" });
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setTeams(nextTeams);
      if (nextTeams.length === 0) {
        setSelectedTeamId(null);
        setHome(null);
        await writeSelectedTeamId(null);
        return;
      }
      const storedId = preferredTeamId === undefined ? await readSelectedTeamId() : preferredTeamId;
      const nextSelected =
        (storedId && nextTeams.some((team) => team.id === storedId) ? storedId : null) ?? nextTeams[0].id;
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setSelectedTeamId(nextSelected);
      await writeSelectedTeamId(nextSelected);
      const nextHome = await getTeamHome(nextSelected);
      if (requestVersion === requestVersionRef.current) {
        setHome(nextHome);
      }
    } catch (loadError) {
      if (requestVersion === requestVersionRef.current) {
        setHome(null);
        setError(loadError);
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [authStatus]);

  const selectTeam = useCallback(async (teamId: string) => {
    if (authStatus !== "ready") {
      return;
    }
    const requestVersion = ++requestVersionRef.current;
    setIsLoading(true);
    setError(null);
    try {
      setSelectedTeamId(teamId);
      await writeSelectedTeamId(teamId);
      const nextHome = await getTeamHome(teamId);
      if (requestVersion === requestVersionRef.current) {
        setHome(nextHome);
      }
    } catch (loadError) {
      if (requestVersion === requestVersionRef.current) {
        setHome(null);
        setError(loadError);
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === "ready") {
      void load();
      return;
    }
    requestVersionRef.current += 1;
    reset();
    void writeSelectedTeamId(null);
  }, [authStatus, load, reset]);

  const value = useMemo<TeamContextValue>(
    () => ({
      teams,
      selectedTeamId,
      home,
      role: home?.current_membership.role ?? null,
      isLoading,
      error,
      refresh: () => load(selectedTeamId),
      selectTeam
    }),
    [teams, selectedTeamId, home, isLoading, error, load, selectTeam]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeamContext() {
  const value = useContext(TeamContext);
  if (!value) {
    throw new Error("useTeamContext must be used within TeamProvider");
  }
  return value;
}
