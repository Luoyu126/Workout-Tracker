import { apiRequest } from "@/lib/api/client";
import { normalizeOptionalText, omitUndefined } from "@/lib/validation/text";

import type { MatchDetails } from "@/features/events/api";

import { normalizeAttendanceNote } from "./validation";

export type AttendanceStatus = "present" | "late" | "absent" | "excused";

export type Attendance = {
  id: string;
  event_id: string;
  user_id: string;
  status: AttendanceStatus;
  recorded_by: string;
  recorded_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
};

export type EventCompletion = {
  event_id: string;
  status: string;
  attendance_count: number;
  reward_count: number;
};

export type EventCompletionInput = {
  match_details?: Partial<{
    team_score: MatchDetails["team_score"];
    opponent_score: MatchDetails["opponent_score"];
    result: MatchDetails["result"];
    notes: string | null;
  }> | null;
};

export type AttendanceBoardRow = {
  user_id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  total: number;
  attendance_rate: number;
};

export function getEventAttendance(eventId: string) {
  return apiRequest<Attendance[]>(`/api/v1/events/${eventId}/attendance`);
}

export function getTeamAttendanceBoard(
  teamId: string,
  options?: { startsAfter?: string | null; startsBefore?: string | null }
) {
  const params = new URLSearchParams();
  if (options?.startsAfter) {
    params.set("starts_after", options.startsAfter);
  }
  if (options?.startsBefore) {
    params.set("starts_before", options.startsBefore);
  }
  const query = params.toString();
  return apiRequest<AttendanceBoardRow[]>(`/api/v1/teams/${teamId}/attendance-board${query ? `?${query}` : ""}`);
}

export function upsertAttendance(
  eventId: string,
  userId: string,
  status: AttendanceStatus,
  note?: string | null
) {
  const normalizedNote = note === undefined || note === null ? null : normalizeAttendanceNote(note);
  return apiRequest<Attendance>(`/api/v1/events/${eventId}/attendance/${userId}`, {
    method: "PUT",
    body: {
      status,
      note: normalizedNote
    }
  });
}

export function completeEvent(eventId: string, input: EventCompletionInput = {}) {
  const request =
    input.match_details === undefined
      ? { method: "POST" as const }
      : {
          method: "POST" as const,
          body: {
            match_details:
              input.match_details === null
                ? null
                : omitUndefined({
                    team_score: input.match_details.team_score,
                    opponent_score: input.match_details.opponent_score,
                    result: input.match_details.result,
                    notes: normalizeOptionalText(input.match_details.notes)
                  })
          }
        };
  return apiRequest<EventCompletion>(`/api/v1/events/${eventId}/complete`, {
    ...request
  });
}
