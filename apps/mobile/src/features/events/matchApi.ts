import { apiRequest } from "@/lib/api/client";
import { generateClientUuid } from "@/lib/uuid";

import type { AttendanceStatus } from "../attendance/api";
import type { MatchDetails, TeamEvent } from "./api";

export type MatchEntryType = "goal" | "yellow_card" | "red_card" | "substitution";

export type MatchLogEntry = {
  id: string;
  event_id: string;
  entry_type: MatchEntryType;
  minute: number;
  player_name: string | null;
  player_number: string | null;
  sub_out_player_name: string | null;
  sub_out_player_number: string | null;
  sub_in_player_name: string | null;
  sub_in_player_number: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type LiveBoard = {
  event: TeamEvent;
  match_details: MatchDetails | null;
  logs: MatchLogEntry[];
  counts: Record<MatchEntryType, number>;
};

export type MatchSummaryAttendance = {
  user_id: string;
  status: AttendanceStatus;
};

export type MatchSummaryReward = {
  user_id: string;
  amount: number;
};

export type MatchSummary = LiveBoard & {
  attendance: MatchSummaryAttendance[];
  rewards: MatchSummaryReward[];
};

export type MatchLogInput = {
  id?: string;
  entry_type: MatchEntryType;
  minute: number;
  player_name?: string | null;
  player_number?: string | null;
  sub_out_player_name?: string | null;
  sub_out_player_number?: string | null;
  sub_in_player_name?: string | null;
  sub_in_player_number?: string | null;
};

export function getLiveBoard(eventId: string) {
  return apiRequest<LiveBoard>(`/api/v1/events/${eventId}/live-board`);
}

export function getMatchLogs(eventId: string, after?: string | null) {
  const query = after ? `?after=${encodeURIComponent(after)}` : "";
  return apiRequest<MatchLogEntry[]>(`/api/v1/events/${eventId}/match-logs${query}`);
}

export function createMatchLog(eventId: string, input: MatchLogInput) {
  return apiRequest<MatchLogEntry>(`/api/v1/events/${eventId}/match-logs`, {
    method: "POST",
    body: {
      ...input,
      id: input.id ?? generateClientUuid()
    }
  });
}

export function deleteMatchLog(logId: string) {
  return apiRequest<void>(`/api/v1/match-logs/${logId}`, {
    method: "DELETE"
  });
}

export function getMatchSummary(eventId: string) {
  return apiRequest<MatchSummary>(`/api/v1/events/${eventId}/summary`);
}
