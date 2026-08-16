import { apiRequest } from "@/lib/api/client";
import { normalizeOptionalText, omitUndefined } from "@/lib/validation/text";

export type Team = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type TeamStatus = Team["status"];

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Membership = {
  id: string;
  team_id: string;
  user_id: string;
  role: "member" | "captain" | "admin";
  jersey_number: string | null;
  position: string | null;
  status: "active" | "inactive" | "pending";
  joined_at: string;
  left_at: string | null;
  created_at: string;
  updated_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
};

export type MembershipRole = Membership["role"];
export type MembershipStatus = Membership["status"];

export type MemberCandidate = {
  id: string;
  name: string;
  student_id: string | null;
  email: string;
  avatar_url: string | null;
};

export type MembershipInput = {
  user_id: string;
  role?: MembershipRole;
  jersey_number?: string | null;
  position?: string | null;
  status?: MembershipStatus;
};

export type MembershipUpdateInput = {
  role?: MembershipRole | null;
  jersey_number?: string | null;
  position?: string | null;
  status?: MembershipStatus | null;
  left_at?: string | null;
};

export type TeamMembersQuery = {
  role?: MembershipRole | null;
  status?: MembershipStatus | null;
};

export type TeamHome = {
  team: Team;
  current_membership: Membership;
  captains: Membership[];
  member_count: number;
  upcoming_events: Array<{
    id: string;
    type: "training" | "match" | "other";
    title: string;
    location: string | null;
    start_time: string;
    status: "published";
  }>;
  attendance_summary: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    total: number;
  };
  coin_summary: {
    balance: number;
    team_ledger_total: number;
  };
};

export type TeamUpdateInput = {
  name?: string | null;
  description?: string | null;
  logo_url?: string | null;
  status?: Team["status"] | null;
};

export function getMyTeams(options: { status?: TeamStatus | null } = {}) {
  const params = new URLSearchParams();
  if (options.status) {
    params.set("status", options.status);
  }
  const queryString = params.toString();
  return apiRequest<Team[]>(`/api/v1/teams${queryString ? `?${queryString}` : ""}`);
}

export function getMyOrganizations() {
  return apiRequest<Organization[]>("/api/v1/organizations");
}

export function getTeamHome(teamId: string) {
  return apiRequest<TeamHome>(`/api/v1/teams/${teamId}/home`);
}

export function updateTeam(teamId: string, input: TeamUpdateInput) {
  return apiRequest<Team>(`/api/v1/teams/${teamId}`, {
    method: "PATCH",
    body: omitUndefined({
      name: input.name === undefined || input.name === null ? input.name : input.name.trim(),
      description: normalizeOptionalText(input.description),
      logo_url: normalizeOptionalText(input.logo_url),
      status: input.status
    })
  });
}

export function getTeamMembers(teamId: string, query: TeamMembersQuery = {}) {
  const params = new URLSearchParams();
  if (query.role) {
    params.set("role", query.role);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  const queryString = params.toString();
  return apiRequest<Membership[]>(`/api/v1/teams/${teamId}/members${queryString ? `?${queryString}` : ""}`);
}

export function getTeamMember(teamId: string, userId: string) {
  return apiRequest<Membership>(`/api/v1/teams/${teamId}/members/${userId}`);
}

export function getMemberCandidates(teamId: string, query: string, limit = 10) {
  const params = new URLSearchParams();
  params.set("query", query.trim());
  params.set("limit", String(limit));
  return apiRequest<MemberCandidate[]>(`/api/v1/teams/${teamId}/member-candidates?${params.toString()}`);
}

export function addTeamMember(teamId: string, input: MembershipInput) {
  return apiRequest<Membership>(`/api/v1/teams/${teamId}/members`, {
    method: "POST",
    body: omitUndefined({
      user_id: input.user_id.trim(),
      role: input.role,
      jersey_number: normalizeOptionalText(input.jersey_number),
      position: normalizeOptionalText(input.position),
      status: input.status
    })
  });
}

export function updateTeamMember(teamId: string, userId: string, input: MembershipUpdateInput) {
  return apiRequest<Membership>(`/api/v1/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: omitUndefined({
      role: input.role,
      jersey_number: normalizeOptionalText(input.jersey_number),
      position: normalizeOptionalText(input.position),
      status: input.status,
      left_at: input.left_at
    })
  });
}
