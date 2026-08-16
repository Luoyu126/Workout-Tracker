import { apiRequest } from "@/lib/api/client";
import { generateClientUuid } from "@/lib/uuid";
import { normalizeOptionalText, omitUndefined } from "@/lib/validation/text";

export type EventStatus = "draft" | "published" | "completed" | "cancelled";
export type EventType = "training" | "match" | "other";
export type SignupStatus = "going" | "not_going" | "maybe";

export type MatchDetails = {
  id: string;
  event_id: string;
  opponent: string;
  team_score: number | null;
  opponent_score: number | null;
  result: "win" | "draw" | "loss" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamEvent = {
  id: string;
  team_id: string;
  type: EventType;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  signup_deadline: string | null;
  status: EventStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  match_details: MatchDetails | null;
};

export type EventSignup = {
  id: string | null;
  event_id: string;
  user_id: string;
  status: SignupStatus;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
};

export type EventInput = {
  id?: string;
  type?: EventType;
  title: string;
  description?: string | null;
  location?: string | null;
  start_time: string;
  end_time?: string | null;
  signup_deadline?: string | null;
};

export type MatchInput = {
  event: EventInput;
  match_details: {
    opponent: string;
    notes?: string | null;
  };
};

export type EventUpdateInput = Partial<Omit<EventInput, "type">> & {
  match_details?: Partial<{
    opponent: string;
    team_score: number | null;
    opponent_score: number | null;
    result: "win" | "draw" | "loss" | null;
    notes: string | null;
  }> | null;
};

export type TeamEventsQuery = {
  type?: EventType | null;
  status?: EventStatus | null;
  startsAfter?: string | null;
  startsBefore?: string | null;
};

export function getTeamEvents(teamId: string, query: TeamEventsQuery = {}) {
  const params = new URLSearchParams();
  if (query.type) {
    params.set("type", query.type);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.startsAfter) {
    params.set("starts_after", query.startsAfter);
  }
  if (query.startsBefore) {
    params.set("starts_before", query.startsBefore);
  }
  const queryString = params.toString();
  return apiRequest<TeamEvent[]>(`/api/v1/teams/${teamId}/events${queryString ? `?${queryString}` : ""}`);
}

export function createEvent(teamId: string, input: EventInput) {
  return apiRequest<TeamEvent>(`/api/v1/teams/${teamId}/events`, {
    method: "POST",
    body: omitUndefined({
      id: input.id ?? generateClientUuid(),
      type: input.type,
      title: input.title.trim(),
      description: normalizeOptionalText(input.description),
      location: normalizeOptionalText(input.location),
      start_time: input.start_time,
      end_time: input.end_time,
      signup_deadline: input.signup_deadline
    })
  });
}

export function createMatch(teamId: string, input: MatchInput) {
  return apiRequest<TeamEvent>(`/api/v1/teams/${teamId}/matches`, {
    method: "POST",
    body: {
      event: omitUndefined({
        id: input.event.id ?? generateClientUuid(),
        type: input.event.type,
        title: input.event.title.trim(),
        description: normalizeOptionalText(input.event.description),
        location: normalizeOptionalText(input.event.location),
        start_time: input.event.start_time,
        end_time: input.event.end_time,
        signup_deadline: input.event.signup_deadline
      }),
      match_details: omitUndefined({
        opponent: input.match_details.opponent.trim(),
        notes: normalizeOptionalText(input.match_details.notes)
      })
    }
  });
}

export function getEvent(eventId: string) {
  return apiRequest<TeamEvent>(`/api/v1/events/${eventId}`);
}

export function updateEvent(eventId: string, input: EventUpdateInput) {
  const matchDetails =
    input.match_details === null
      ? null
      : input.match_details === undefined
        ? undefined
        : omitUndefined({
            opponent: input.match_details.opponent?.trim(),
            team_score: input.match_details.team_score,
            opponent_score: input.match_details.opponent_score,
            result: input.match_details.result,
            notes: normalizeOptionalText(input.match_details.notes)
          });

  return apiRequest<TeamEvent>(`/api/v1/events/${eventId}`, {
    method: "PATCH",
    body: omitUndefined({
      title: input.title?.trim(),
      description: normalizeOptionalText(input.description),
      location: normalizeOptionalText(input.location),
      start_time: input.start_time,
      end_time: input.end_time,
      signup_deadline: input.signup_deadline,
      match_details: matchDetails
    })
  });
}

export function publishEvent(eventId: string) {
  return apiRequest<TeamEvent>(`/api/v1/events/${eventId}/publish`, {
    method: "POST"
  });
}

export function deleteEvent(eventId: string) {
  return apiRequest<void>(`/api/v1/events/${eventId}`, {
    method: "DELETE"
  });
}

export function getMySignup(eventId: string) {
  return apiRequest<EventSignup>(`/api/v1/events/${eventId}/signup`);
}

export function getEventSignups(eventId: string, status?: SignupStatus | null) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  const query = params.toString();
  return apiRequest<EventSignup[]>(`/api/v1/events/${eventId}/signups${query ? `?${query}` : ""}`);
}

export function updateMySignup(eventId: string, status: SignupStatus, note?: string | null) {
  return apiRequest<EventSignup>(`/api/v1/events/${eventId}/signup`, {
    method: "PUT",
    body: {
      status,
      note: normalizeOptionalText(note) ?? null
    }
  });
}
